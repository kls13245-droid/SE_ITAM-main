import os
import tempfile
from pathlib import Path

from django.db.models import Count
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.utils.http import content_disposition_header

from assets.services import ValidationError
from assets.views import api, body, error, require_admin_confirm
from .models import CpuSpec, MasterList, PartCode, PptTemplate, ReviewCase, ReviewOutput
from . import master_check, spec
from .services import (active_template, add_list_value, attach_source, build_spec_excel, calc_items, case_items, check_upload,
                       clean_items, generate, import_items, import_master, list_dict, safe_stem, save_items)

CASE_FIELDS = ('title', 'line', 'product', 'year', 'status', 'note', 'input_mode')
INPUT_MODES = [m for m, _ in ReviewCase.INPUT_CHOICES]
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
    if hasattr(c, 'item_count'):
        d['item_count'] = c.item_count
    else:
        d['item_count'] = c.spec_items.count() if c.pk else 0
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
    if 'input_mode' in out:
        mode = out['input_mode'].upper() or 'FORM'
        if mode not in INPUT_MODES:
            raise ValidationError('구매 사양 입력 방식은 FORM(화면 입력) 또는 EXCEL(엑셀 올리기)이어야 합니다.')
        out['input_mode'] = mode
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
        qs = ReviewCase.objects.select_related('created_by').annotate(
            output_count=Count('outputs', distinct=True), item_count=Count('spec_items', distinct=True))
        tpl_path, tpl_name = active_template()
        return JsonResponse({'items': [case_dict(c) for c in qs], 'template': tpl_name or ''})
    # multipart(엑셀 같이 올림) 또는 JSON 둘 다 받는다
    data = request.POST if request.content_type.startswith('multipart') else body(request)
    fields = clean_case(data)
    case = ReviewCase(created_by=request.user, **fields)
    upload = request.FILES.get('file')
    if upload:
        info = attach_source(case, upload)
        case.input_mode = 'EXCEL'
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
    case.input_mode = 'EXCEL'
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


# ---------------------------------------------------------------------------
# 화면에서 입력하는 구매 사양
# ---------------------------------------------------------------------------
def items_response(case, items, **extra):
    return JsonResponse({'items': items, 'calc': calc_items(items), 'case': case_dict(case, outputs=True), **extra})


@api('GET', 'PUT')
def case_items_view(request, case_id):
    case = ReviewCase.objects.get(id=case_id)
    if request.method == 'PUT':
        items = save_items(case, body(request).get('items'))
        case.refresh_from_db()
        return items_response(case, items)
    return items_response(case, case_items(case), sw_products=spec.SW_PRODUCTS, kinds={
        'etc': spec.ETC_KINDS, 'nw': spec.NW_KINDS, 'license': spec.LICENSE_KINDS})


@api('POST')
def case_items_calc(request, case_id):
    """저장하지 않고 계산값만 (화면에서 입력하는 동안 자동 계산 표시용)"""
    ReviewCase.objects.get(id=case_id)
    items = clean_items(body(request).get('items'))
    return JsonResponse({'calc': calc_items(items)})


@api('POST')
def case_items_import(request, case_id):
    case = ReviewCase.objects.get(id=case_id)
    upload = request.FILES.get('file')
    data = None
    if upload:
        check_upload(upload)
        data = upload.read()
    items, warnings = import_items(case, data)
    case.refresh_from_db()
    return items_response(case, items, warnings=warnings)


@api('GET')
def case_items_excel(request, case_id):
    """화면 입력값으로 만든 구매 사양 엑셀 내려받기 (PPT 없이 엑셀만)"""
    case = ReviewCase.objects.get(id=case_id)
    with tempfile.TemporaryDirectory() as tmp:
        path = build_spec_excel(case, Path(tmp) / 'spec.xlsx')
        data = path.read_bytes()
    name = f"{safe_stem('_'.join(p for p in (case.year, case.line, case.product, case.title) if p))}_구매사양.xlsx"
    resp = HttpResponse(data, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    resp['Content-Disposition'] = content_disposition_header(True, name)
    return resp


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
        'lists': [list_dict(m) for m in MasterList.objects.all()],
        'cpus': [{'id': c.id, 'name': c.name, 'clock': c.clock, 'cores': c.cores} for c in CpuSpec.objects.all()],
    })


@api('GET')
def master_check_view(request):
    """기준정보 검증: 문제 목록 (fix = 바로 정리 가능, ask = 확인 필요, info = 참고)"""
    return JsonResponse({'issues': master_check.check()})


@api('POST')
def master_check_fix(request):
    """공백·빈 값·중복만 정리하고 바뀐 내용과 남은 문제 목록을 돌려준다"""
    changes = master_check.apply_safe()
    return JsonResponse({'changes': changes, 'issues': master_check.check()})


@api('POST')
def master_import(request):
    upload = request.FILES.get('file')
    check_upload(upload)
    return JsonResponse(import_master(upload.read(), dry_run=request.POST.get('mode') == 'preview'))


@api('POST')
def master_list_add(request):
    """구매 사양 화면의 '목록에 추가': 선택 목록에 값을 더한다 (변경 이력이 남음)"""
    d = body(request)
    return JsonResponse(add_list_value(d.get('name'), d.get('value'), d.get('clock'), d.get('cores')))


@api('PUT')
def part_code_update(request, code_id):
    p = PartCode.objects.get(id=code_id)
    p.cis_code = str(body(request).get('cis_code') or '').strip()
    p.save()
    return JsonResponse({'id': p.id, 'name': p.name, 'key': p.key, 'cis_code': p.cis_code})
