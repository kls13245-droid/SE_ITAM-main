import os

from django.db.models import Count
from django.http import FileResponse, Http404, JsonResponse

from assets.services import ValidationError
from assets.views import api, body, error, require_admin_confirm
from .models import CpuSpec, MasterList, PartCode, PptTemplate, ReviewCase, ReviewOutput
from .services import active_template, attach_source, check_upload, generate, import_master

CASE_FIELDS = ('title', 'line', 'product', 'year', 'status', 'note')
STATUSES = [s for s, _ in ReviewCase.STATUS_CHOICES]
STATUS_LABELS = dict(ReviewCase.STATUS_CHOICES)
# 한글 이름으로 보내도 받아 준다 (예전 화면·스크립트 호환)
STATUS_ALIASES = {label: code for code, label in ReviewCase.STATUS_CHOICES}
STATUS_ALIASES['완료'] = 'APPROVED'


def _dt(v):
    return v.isoformat() if v else None


def output_dict(o):
    return {
        'id': o.id, 'ok': o.ok, 'log': o.log, 'created_at': _dt(o.created_at),
        'created_by': o.created_by.username if o.created_by else '',
        'pptx_name': os.path.basename(o.pptx.name) if o.pptx else '',
        'xlsx_name': os.path.basename(o.xlsx.name) if o.xlsx else '',
    }


def case_dict(c, outputs=False):
    d = {f: getattr(c, f) for f in CASE_FIELDS}
    d.update({
        'id': c.id, 'source_name': c.source_name, 'has_source': bool(c.source_excel),
        'source_uploaded_at': _dt(c.source_uploaded_at), 'created_at': _dt(c.created_at),
        'updated_at': _dt(c.updated_at), 'created_by': c.created_by.username if c.created_by else '',
        'status_label': STATUS_LABELS.get(c.status, c.status),
    })
    if outputs:
        d['outputs'] = [output_dict(o) for o in c.outputs.select_related('created_by')[:20]]
    else:
        d['output_count'] = getattr(c, 'output_count', None)
    return d


def clean_case(data, partial=False):
    out = {}
    for f in CASE_FIELDS:
        if f in data or not partial:
            out[f] = str(data.get(f) or '').strip()
    if 'status' in out:
        status = out['status'] or 'DRAFT'
        status = STATUS_ALIASES.get(status, status.upper())
        if status not in STATUSES:
            raise ValidationError(f"상태는 {', '.join(STATUS_LABELS.values())} 중 하나여야 합니다.")
        out['status'] = status
    if 'year' in out and out['year'] and not (out['year'].isdigit() and len(out['year']) == 4):
        raise ValidationError('심의 연도는 4자리 숫자로 입력해 주세요. (예: 2026)')
    return out


def _file_response(field):
    if not field:
        raise Http404
    try:
        return FileResponse(field.open('rb'), as_attachment=True, filename=os.path.basename(field.name))
    except FileNotFoundError:
        raise Http404


# ---------------------------------------------------------------------------
# 심의건
# ---------------------------------------------------------------------------
@api('GET', 'POST')
def cases(request):
    if request.method == 'GET':
        qs = ReviewCase.objects.select_related('created_by').annotate(output_count=Count('outputs'))
        tpl_path, tpl_name = active_template()
        return JsonResponse({'items': [case_dict(c) for c in qs], 'template': tpl_name or ''})
    # multipart(엑셀 같이 올림) 또는 JSON 둘 다 받는다
    data = request.POST if request.content_type.startswith('multipart') else body(request)
    fields = clean_case(data)
    case = ReviewCase(created_by=request.user, **fields)
    upload = request.FILES.get('file')
    if upload:
        info = attach_source(case, upload)
        if not case.title:
            case.title = info.get('title') or os.path.splitext(upload.name)[0]
    if not case.title:
        raise ValidationError('업무명을 입력하거나 구매 사양 엑셀을 올려 주세요.')
    case.save()
    return JsonResponse(case_dict(case, outputs=True), status=201)


@api('GET', 'PUT', 'DELETE')
def case_detail(request, case_id):
    case = ReviewCase.objects.select_related('created_by').get(id=case_id)
    if request.method == 'GET':
        return JsonResponse(case_dict(case, outputs=True))
    if request.method == 'PUT':
        fields = clean_case(body(request), partial=True)
        if 'title' in fields and not fields['title']:
            raise ValidationError('업무명은 비워 둘 수 없습니다.')
        for k, v in fields.items():
            setattr(case, k, v)
        case.save()
        return JsonResponse(case_dict(case, outputs=True))
    require_admin_confirm(request)
    for o in case.outputs.all():
        o.pptx.delete(save=False)
        o.xlsx.delete(save=False)
    if case.source_excel:
        case.source_excel.delete(save=False)
    case.delete()
    return JsonResponse({'success': True})


@api('POST')
def case_upload(request, case_id):
    case = ReviewCase.objects.get(id=case_id)
    attach_source(case, request.FILES.get('file'))
    case.save()
    return JsonResponse(case_dict(case, outputs=True))


@api('GET')
def case_source(request, case_id):
    return _file_response(ReviewCase.objects.get(id=case_id).source_excel)


@api('POST')
def case_generate(request, case_id):
    case = ReviewCase.objects.get(id=case_id)
    output = generate(case, request.user)
    return JsonResponse({'output': output_dict(output), 'case': case_dict(case, outputs=True)})


@api('GET')
def output_file(request, output_id, kind):
    o = ReviewOutput.objects.get(id=output_id)
    if kind not in ('pptx', 'xlsx'):
        raise Http404
    return _file_response(getattr(o, kind))


# ---------------------------------------------------------------------------
# PPT 템플릿
# ---------------------------------------------------------------------------
@api('GET', 'POST')
def template(request):
    if request.method == 'POST':
        upload = request.FILES.get('file')
        check_upload(upload, exts=('.pptx',), label='PPT 템플릿')
        tpl = PptTemplate(name=upload.name, uploaded_by=request.user)
        tpl.file.save(upload.name, upload, save=False)
        tpl.save()
        PptTemplate.objects.exclude(id=tpl.id).update(is_active=False)
    _, name = active_template()
    current = PptTemplate.objects.filter(is_active=True).first()
    return JsonResponse({'name': name or '', 'uploaded_at': _dt(current.uploaded_at) if current else None})


@api('GET')
def template_file(request):
    current = PptTemplate.objects.filter(is_active=True).first()
    if not current:
        return error('올려 둔 템플릿이 없습니다.', 404)
    return _file_response(current.file)


# ---------------------------------------------------------------------------
# 기준정보 (이름 관리자)
# ---------------------------------------------------------------------------
@api('GET')
def master(request):
    return JsonResponse({
        'codes': [{'id': p.id, 'name': p.name, 'key': p.key, 'cis_code': p.cis_code} for p in PartCode.objects.all()],
        'lists': [{'id': m.id, 'name': m.name, 'group': m.group, 'values': m.values, 'source': m.source}
                  for m in MasterList.objects.all()],
        'cpus': [{'id': c.id, 'name': c.name, 'clock': c.clock, 'cores': c.cores} for c in CpuSpec.objects.all()],
    })


@api('POST')
def master_import(request):
    upload = request.FILES.get('file')
    check_upload(upload)
    return JsonResponse(import_master(upload.read(), dry_run=request.POST.get('mode') == 'preview'))


@api('PUT')
def part_code_update(request, code_id):
    p = PartCode.objects.get(id=code_id)
    p.cis_code = str(body(request).get('cis_code') or '').strip()
    p.save()
    return JsonResponse({'id': p.id, 'name': p.name, 'key': p.key, 'cis_code': p.cis_code})
