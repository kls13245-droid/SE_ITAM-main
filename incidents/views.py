from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import JsonResponse
from django.utils import timezone

from assets.models import FieldAsset
from assets.services import ValidationError, _parse_date
from assets.views import api, body, error, require_admin_confirm
from . import report
from .models import Incident, IncidentLog, ReportBaseline

KINDS = dict(Incident.KIND_CHOICES)
STATUSES = dict(Incident.STATUS_CHOICES)
# 한글로 보내도 받아 준다
KIND_ALIASES = {**{v: k for k, v in KINDS.items()}, '유지보수': 'MAINT', 'PM': 'PM'}
STATUS_ALIASES = {**{v: k for k, v in STATUSES.items()}, '진행중': 'IN_PROGRESS'}


def _dt(v):
    return v.isoformat() if v else None


def log_dict(log):
    return {'id': log.id, 'date': _dt(log.date), 'text': log.text, 'level': log.level, 'order': log.order,
            'created_by': log.created_by.username if log.created_by else '', 'created_at': _dt(log.created_at)}


def incident_dict(inc, logs=True):
    d = {
        'id': inc.id, 'kind': inc.kind, 'kind_label': KINDS.get(inc.kind, inc.kind), 'title': inc.title,
        'status': inc.status, 'status_label': STATUSES.get(inc.status, inc.status),
        'occurred_on': _dt(inc.occurred_on), 'done_on': _dt(inc.done_on), 'asset_name': inc.asset_name,
        'field_asset_id': inc.field_asset_id,
        'field_asset': ({'id': inc.field_asset.id, 'hostname': inc.field_asset.hostname,
                         'site_group': inc.field_asset.site_group} if inc.field_asset_id else None),
        'hide_in_report': inc.hide_in_report,
        'created_by': inc.created_by.username if inc.created_by else '',
        'created_at': _dt(inc.created_at), 'updated_at': _dt(inc.updated_at),
    }
    if logs:
        d['logs'] = [log_dict(l) for l in inc.logs.all()]
    else:
        d['log_count'] = getattr(inc, 'log_count', None)
        d['last_log_date'] = _dt(getattr(inc, 'last_log_date', None))
    return d


def _report_date(data):
    return _parse_date(str(data.get('date') or ''), '보고 기준') or timezone.localdate()


def clean_incident(data, partial=False, current=None):
    out = {}
    if 'kind' in data or not partial:
        kind = str(data.get('kind') or 'FAULT').strip()
        kind = KIND_ALIASES.get(kind, kind.upper())
        if kind not in KINDS:
            raise ValidationError(f"유형은 {', '.join(KINDS.values())} 중 하나여야 합니다.")
        out['kind'] = kind
    if 'title' in data or not partial:
        title = str(data.get('title') or '').strip()
        if not title:
            raise ValidationError('제목을 입력해 주세요.')
        if len(title) > 200:
            raise ValidationError('제목은 200자까지 쓸 수 있습니다.')
        out['title'] = title
    if 'status' in data or not partial:
        status = str(data.get('status') or 'IN_PROGRESS').strip()
        status = STATUS_ALIASES.get(status, status.upper())
        if status not in STATUSES:
            raise ValidationError(f"상태는 {', '.join(STATUSES.values())} 중 하나여야 합니다.")
        out['status'] = status
    if 'occurred_on' in data or not partial:
        out['occurred_on'] = _parse_date(str(data.get('occurred_on') or ''), '발생일') or timezone.localdate()
    if 'done_on' in data:
        out['done_on'] = _parse_date(str(data.get('done_on') or ''), '완료일')
    if 'asset_name' in data:
        out['asset_name'] = str(data.get('asset_name') or '').strip()[:200]
    if 'hide_in_report' in data:
        out['hide_in_report'] = bool(data.get('hide_in_report'))
    if 'field_asset_id' in data:
        fid = data.get('field_asset_id')
        if fid in (None, ''):
            out['field_asset'] = None
        else:
            try:
                out['field_asset'] = FieldAsset.objects.get(id=int(fid))
            except (FieldAsset.DoesNotExist, ValueError, TypeError):
                raise ValidationError('연결할 현장 장비를 찾지 못했습니다.')
            if not out.get('asset_name') and not (current and current.asset_name):
                out['asset_name'] = out['field_asset'].hostname
    # 완료 상태면 완료일이 있어야 하고, 완료가 아니면 완료일을 비운다
    status = out.get('status', current.status if current else 'IN_PROGRESS')
    done_on = out['done_on'] if 'done_on' in out else (current.done_on if current else None)
    if status == 'DONE' and not done_on:
        out['done_on'] = timezone.localdate()
    elif status != 'DONE' and done_on:
        out['done_on'] = None
    occurred = out.get('occurred_on', current.occurred_on if current else None)
    if out.get('done_on') and occurred and out['done_on'] < occurred:
        raise ValidationError('완료일이 발생일보다 빠릅니다.')
    return out


def clean_log(data, partial=False):
    out = {}
    if 'text' in data or not partial:
        text = str(data.get('text') or '').strip()
        if not text:
            raise ValidationError('진행 내용을 입력해 주세요.')
        out['text'] = text
    if 'date' in data:
        out['date'] = _parse_date(str(data.get('date') or ''), '진행 기록')
    if 'level' in data or not partial:
        try:
            level = int(data.get('level') or 1)
        except (TypeError, ValueError):
            raise ValidationError('들여쓰기는 1~3 중 하나여야 합니다.')
        if level not in (1, 2, 3):
            raise ValidationError('들여쓰기는 1~3 중 하나여야 합니다.')
        out['level'] = level
    return out


# ---------------------------------------------------------------------------
# 건 목록·입력
# ---------------------------------------------------------------------------
@api('GET', 'POST')
def incidents(request):
    if request.method == 'POST':
        data = body(request)
        with transaction.atomic():
            inc = Incident.objects.create(created_by=request.user, **clean_incident(data))
            first = str(data.get('first_log') or '').strip()
            if first:
                IncidentLog.objects.create(incident=inc, date=inc.occurred_on, text=first, level=1, order=1,
                                           created_by=request.user)
        return JsonResponse(incident_dict(inc), status=201)

    year = request.GET.get('year') or str(timezone.localdate().year)
    if not year.isdigit():
        return error('연도는 숫자로 보내 주세요.')
    qs = (Incident.objects.select_related('field_asset', 'created_by')
          .annotate(log_count=Count('logs'), last_log_date=Max('logs__date')))
    if year != '0':
        # 그 해에 생긴 건 + 그 전에 생겨 아직 안 끝난 건
        qs = qs.filter(Q(occurred_on__year=int(year)) | Q(occurred_on__year__lt=int(year), done_on__isnull=True)
                       | Q(done_on__year=int(year)))
    for key in ('kind', 'status'):
        v = request.GET.get(key)
        if v:
            qs = qs.filter(**{f'{key}__in': v.split(',')})
    q = (request.GET.get('q') or '').strip()
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(asset_name__icontains=q) | Q(logs__text__icontains=q)).distinct()
    y = int(year) if year != '0' else timezone.localdate().year
    return JsonResponse({
        'items': [incident_dict(i, logs=False) for i in qs],
        'counts': report.counts(y), 'year': y,
    })


@api('GET', 'PUT', 'DELETE')
def incident_detail(request, incident_id):
    inc = Incident.objects.select_related('field_asset', 'created_by').get(id=incident_id)
    if request.method == 'PUT':
        for k, v in clean_incident(body(request), partial=True, current=inc).items():
            setattr(inc, k, v)
        inc.save()
    elif request.method == 'DELETE':
        admin = require_admin_confirm(request)
        inc.delete()
        return JsonResponse({'message': 'Deleted', 'approved_by': admin.username})
    return JsonResponse(incident_dict(inc))


@api('POST')
def incident_logs(request, incident_id):
    inc = Incident.objects.get(id=incident_id)
    data = clean_log(body(request))
    data.setdefault('date', timezone.localdate())
    last = inc.logs.aggregate(m=Max('order'))['m'] or 0
    IncidentLog.objects.create(incident=inc, order=last + 1, created_by=request.user, **data)
    inc.save(update_fields=['updated_at'])
    return JsonResponse(incident_dict(Incident.objects.get(id=incident_id)), status=201)


@api('PUT', 'DELETE')
def incident_log_detail(request, log_id):
    log = IncidentLog.objects.select_related('incident').get(id=log_id)
    inc = log.incident
    if request.method == 'DELETE':
        log.delete()
    else:
        for k, v in clean_log(body(request), partial=True).items():
            setattr(log, k, v)
        log.save()
    inc.save(update_fields=['updated_at'])
    return JsonResponse(incident_dict(Incident.objects.get(id=inc.id)))


@api('POST')
def incident_logs_reorder(request, incident_id):
    inc = Incident.objects.get(id=incident_id)
    ids = [int(i) for i in body(request).get('ids') or []]
    logs = {l.id: l for l in inc.logs.all()}
    if sorted(ids) != sorted(logs):
        raise ValidationError('진행 기록 목록이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.')
    for n, i in enumerate(ids, start=1):
        logs[i].order = n
    IncidentLog.objects.bulk_update(logs.values(), ['order'])
    return JsonResponse(incident_dict(inc))


@api('GET', 'PUT')
def baseline(request):
    if request.method == 'PUT':
        data = body(request)
        year = int(data.get('year') or timezone.localdate().year)
        values = data.get('values') or {}
        for kind, value in values.items():
            if kind not in KINDS:
                raise ValidationError(f'알 수 없는 유형: {kind}')
        with transaction.atomic():
            for kind, value in values.items():
                if isinstance(value, dict):
                    # 표에 보일 숫자를 직접 입력: {in_progress, done, waiting}
                    nums = []
                    for key, label in (('in_progress', '진행 중'), ('done', '완료'), ('waiting', '보류 및 대기')):
                        try:
                            n = int(value.get(key) or 0)
                        except (TypeError, ValueError):
                            raise ValidationError(f'{KINDS[kind]} {label}: 숫자를 입력해 주세요.')
                        if n < 0:
                            raise ValidationError(f'{KINDS[kind]} {label}: 0 이상이어야 합니다.')
                        nums.append(n)
                    report.set_counts(year, kind, *nums)
                else:
                    # 예전 방식: ITAM 이전 완료 건수만
                    n = int(value or 0)
                    if n < 0:
                        raise ValidationError('이전 완료 건수는 0 이상이어야 합니다.')
                    ReportBaseline.objects.update_or_create(year=year, kind=kind, defaults={'done_before': n})
    else:
        year = int(request.GET.get('year') or timezone.localdate().year)
    return JsonResponse({'year': year, 'counts': report.counts(year)})


# ---------------------------------------------------------------------------
# 주간보고 글 (복사해서 붙여 넣기용)
# ---------------------------------------------------------------------------
@api('POST')
def report_text(request):
    d = _report_date(body(request))
    return JsonResponse({'week': report.week_label(d), 'text': report.preview_text(d),
                         'incident_count': len(report.report_incidents(d))})
