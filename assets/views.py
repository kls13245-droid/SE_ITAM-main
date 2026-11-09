import json
from functools import wraps

from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Prefetch
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Building, Campus, FieldAsset, PMRecord, Rack, ServerAsset
from .services import (
    ValidationError, clean_field_asset, clean_health, field_template_csv, import_field_assets, parse_csv,
    place_field_assets, rack_link, rack_servers_by_field_asset, refresh_asset_pm, sync_rack_server,
    template_csv, to_int, validate_import, validate_server_payload, _parse_date,
)

SERVER_FIELDS = ('id', 'hostname', 'start_u', 'size_u', 'status', 'model_name',
                 'setup_year', 'description', 'specs', 'os_version')


def error(message, status=400, **extra):
    return JsonResponse({'error': message, **extra}, status=status)


def api(*methods, auth=True):
    """API 공통 처리: 로그인 확인, HTTP 메서드 확인, 흔한 예외를 JSON 오류로 변환.

    CSRF는 Django 미들웨어가 검사한다 (프론트는 X-CSRFToken 헤더로 토큰을 보냄).
    """
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if auth and not request.user.is_authenticated:
                return error('로그인이 필요합니다.', 401)
            if methods and request.method not in methods:
                return error('잘못된 요청입니다.', 405)
            try:
                return view(request, *args, **kwargs)
            except ObjectDoesNotExist:
                return error('대상을 찾을 수 없습니다. 다른 사용자가 먼저 삭제했을 수 있습니다. 새로고침해 주세요.', 404)
            except ValidationError as e:
                return error(str(e), 400)
            except AdminConfirmError as e:
                return error(str(e), 403, admin_required=True)
            except (json.JSONDecodeError, KeyError, TypeError, ValueError) as e:
                return error(f'요청 형식이 올바르지 않습니다: {e}', 400)
        return wrapped
    return decorator


def body(request):
    return json.loads(request.body or b'{}')


class AdminConfirmError(Exception):
    pass


ADMIN_FAIL_LIMIT = 5        # 연속 실패 허용 횟수
ADMIN_LOCK_SECONDS = 300    # 초과 시 잠금 시간


def require_admin_confirm(request):
    """삭제 전에 관리자(staff) 아이디/비밀번호를 다시 확인한다. 실패하면 AdminConfirmError.

    로그인한 사람이 관리자가 아니어도, 관리자가 옆에서 자기 계정으로 입력하면 삭제할 수 있다.
    비밀번호를 연속으로 틀리면 잠시 막는다.
    """
    from django.core.cache import cache
    data = body(request)
    username = (data.get('admin_username') or '').strip()
    password = data.get('admin_password') or ''
    if not username or not password:
        raise AdminConfirmError('삭제하려면 관리자 아이디와 비밀번호를 입력해 주세요.')
    key = f'admin-confirm-fail:{request.user.id}'
    if cache.get(key, 0) >= ADMIN_FAIL_LIMIT:
        raise AdminConfirmError('비밀번호를 여러 번 틀려 5분 동안 삭제할 수 없습니다.')
    admin = authenticate(request, username=username, password=password)
    if admin is None:
        cache.set(key, cache.get(key, 0) + 1, ADMIN_LOCK_SECONDS)
        raise AdminConfirmError('관리자 아이디 또는 비밀번호가 틀렸습니다.')
    if not (admin.is_staff or admin.is_superuser):
        raise AdminConfirmError(f'{admin.username} 계정은 관리자 권한이 없습니다.')
    cache.delete(key)
    return admin


def server_dict(server):
    return {f: getattr(server, f) for f in SERVER_FIELDS}


# ---------------------------------------------------------------------------
# 인증
# ---------------------------------------------------------------------------
@ensure_csrf_cookie
@api('GET', auth=False)
def api_csrf(request):
    """프론트가 처음 뜰 때 CSRF 토큰을 받아 가는 용도."""
    return JsonResponse({'csrf_token': get_token(request)})


@api('POST', auth=False)
def api_login(request):
    data = body(request)
    user = authenticate(username=data.get('username'), password=data.get('password'))
    if user is None:
        return error('아이디 또는 비밀번호가 틀렸습니다.', 401)
    login(request, user)
    # 로그인하면 CSRF 토큰이 새로 바뀌므로 새 토큰을 함께 돌려준다
    return JsonResponse({'success': True, 'username': user.username, 'is_admin': user.is_staff or user.is_superuser,
                         'csrf_token': get_token(request)})


@api('POST', auth=False)
def api_logout(request):
    logout(request)
    return JsonResponse({'success': True})


@api('GET', auth=False)
def api_me(request):
    if request.user.is_authenticated:
        u = request.user
        return JsonResponse({'authenticated': True, 'username': u.username, 'is_admin': u.is_staff or u.is_superuser})
    return JsonResponse({'authenticated': False}, status=401)


# ---------------------------------------------------------------------------
# 조회
# ---------------------------------------------------------------------------
@api('GET')
def api_site_data(request):
    # 예전에는 랙마다 쿼리를 따로 보내 장비가 많아지면 느려졌다. 4개 쿼리로 한 번에 읽는다.
    campuses = Campus.objects.prefetch_related(
        Prefetch('buildings', queryset=Building.objects.order_by('id')),
        Prefetch('buildings__racks', queryset=Rack.objects.order_by('id')),
        Prefetch('buildings__racks__servers', queryset=ServerAsset.objects.order_by('id')),
    ).order_by('id')
    data = [{
        'id': c.id, 'name': c.name,
        'buildings': [{
            'id': b.id, 'name': b.name,
            'racks': [{
                'id': r.id, 'name': r.name, 'location': r.location, 'total_u_space': r.total_u_space,
                'servers': [server_dict(s) for s in r.servers.all()],
            } for r in b.racks.all()],
        } for b in c.buildings.all()],
    } for c in campuses]
    return JsonResponse(data, safe=False)


# ---------------------------------------------------------------------------
# 캠퍼스 / 건물 / 랙
# ---------------------------------------------------------------------------
def _name(data):
    name = (data.get('name') or '').strip()
    if not name:
        raise ValidationError('이름을 입력해 주세요.')
    return name


@api('POST')
def add_campus(request):
    campus = Campus.objects.create(name=_name(body(request)))
    return JsonResponse({'id': campus.id, 'name': campus.name, 'buildings': []})


@api('PUT')
def update_campus(request, campus_id):
    campus = Campus.objects.get(id=campus_id)
    campus.name = _name(body(request))
    campus.save()
    return JsonResponse({'id': campus.id, 'name': campus.name})


@api('DELETE')
def delete_campus(request, campus_id):
    campus = Campus.objects.get(id=campus_id)
    admin = require_admin_confirm(request)
    with transaction.atomic():
        servers = ServerAsset.objects.filter(rack__building__campus=campus)
        count = servers.count()
        servers.delete()  # 랙 FK가 SET_NULL이라 장비는 따로 지워야 함
        campus.delete()
    return JsonResponse({'message': 'Deleted', 'deleted_servers': count, 'approved_by': admin.username})


@api('POST')
def add_building(request):
    data = body(request)
    campus = Campus.objects.get(id=data['campus_id'])
    building = Building.objects.create(campus=campus, name=_name(data))
    return JsonResponse({'id': building.id, 'name': building.name, 'racks': []})


@api('PUT')
def update_building(request, building_id):
    building = Building.objects.get(id=building_id)
    building.name = _name(body(request))
    building.save()
    return JsonResponse({'id': building.id, 'name': building.name})


@api('DELETE')
def delete_building(request, building_id):
    building = Building.objects.get(id=building_id)
    admin = require_admin_confirm(request)
    with transaction.atomic():
        servers = ServerAsset.objects.filter(rack__building=building)
        count = servers.count()
        servers.delete()
        building.delete()
    return JsonResponse({'message': 'Deleted', 'deleted_servers': count, 'approved_by': admin.username})


def _rack_height(value, rack=None):
    total = to_int(value, '랙 높이(U)', required=True, minimum=1)
    if total > 60:
        raise ValidationError('랙 높이는 60U 이하로 입력해 주세요.')
    if rack:
        top = max((s.start_u + (s.size_u or 1) - 1 for s in rack.servers.all() if s.start_u), default=0)
        if top > total:
            raise ValidationError(f'U{top}까지 장비가 실장되어 있어 {total}U로 줄일 수 없습니다.')
    return total


@api('POST')
def add_rack(request):
    data = body(request)
    building = Building.objects.get(id=data['building_id'])
    rack = Rack.objects.create(
        building=building, name=_name(data),
        location=data.get('location', ''), total_u_space=_rack_height(data.get('total_u_space', 42)),
    )
    return JsonResponse({'id': rack.id, 'name': rack.name, 'location': rack.location,
                         'total_u_space': rack.total_u_space, 'servers': []})


@api('PUT')
def update_rack(request, rack_id):
    rack = Rack.objects.get(id=rack_id)
    data = body(request)
    if 'name' in data:
        rack.name = _name(data)
    rack.location = data.get('location', rack.location)
    if 'total_u_space' in data:
        rack.total_u_space = _rack_height(data['total_u_space'], rack)
    rack.save()
    return JsonResponse({'id': rack.id, 'name': rack.name, 'location': rack.location,
                         'total_u_space': rack.total_u_space})


@api('DELETE')
def delete_rack(request, rack_id):
    rack = Rack.objects.get(id=rack_id)
    admin = require_admin_confirm(request)
    with transaction.atomic():
        count = rack.servers.count()
        rack.servers.all().delete()
        rack.delete()
    return JsonResponse({'message': 'Deleted', 'deleted_servers': count, 'approved_by': admin.username})


# ---------------------------------------------------------------------------
# 장비
# ---------------------------------------------------------------------------
@api('POST')
def add_server(request):
    data = body(request)
    rack = Rack.objects.get(id=data['rack_id'])
    with transaction.atomic():
        Rack.objects.select_for_update().filter(id=rack.id).first()  # 동시에 같은 U에 넣는 것 방지
        clean = validate_server_payload(rack, data)
        server = ServerAsset.objects.create(
            rack=rack, model_name=data.get('model_name', ''),
            setup_year=data.get('setup_year', ''), description=data.get('description', ''),
            **clean,
        )
    return JsonResponse({**server_dict(server), 'message': 'Success'})


@api('PUT')
def update_server(request, server_id):
    server = ServerAsset.objects.get(id=server_id)
    data = body(request)
    merged = {
        'hostname': data.get('hostname', server.hostname),
        'start_u': data.get('start_u', server.start_u),
        'size_u': data.get('size_u', server.size_u),
        'status': data.get('status', server.status),
        'model_name': data.get('model_name', server.model_name),
        'specs': data.get('specs', server.specs),
        'os_version': data.get('os_version', server.os_version),
    }
    # 화면은 OS 버전을 specs에 넣어 보내므로 specs 값이 있으면 그걸 우선한다
    if isinstance(merged['specs'], dict) and merged['specs'].get('os_version'):
        merged['os_version'] = merged['specs']['os_version']
    with transaction.atomic():
        Rack.objects.select_for_update().filter(id=server.rack_id).first()
        clean = validate_server_payload(server.rack, merged, exclude_id=server.id)
        for k, v in clean.items():
            setattr(server, k, v)
        server.model_name = merged['model_name']
        server.setup_year = data.get('setup_year', server.setup_year)
        server.description = data.get('description', server.description)
        server.save()
    return JsonResponse({**server_dict(server), 'message': 'Updated successfully'})


@api('DELETE')
def delete_server(request, server_id):
    server = ServerAsset.objects.get(id=server_id)
    admin = require_admin_confirm(request)
    server.delete()
    return JsonResponse({'message': 'Deleted', 'approved_by': admin.username})


# ---------------------------------------------------------------------------
# CSV 가져오기
# ---------------------------------------------------------------------------
@api('GET')
def import_template(request):
    resp = HttpResponse(template_csv(), content_type='text/csv; charset=utf-8')
    resp['Content-Disposition'] = 'attachment; filename="rack_import_template.csv"'
    return resp


@api('POST')
def import_servers(request):
    """multipart: file, rack_id, mode=preview|commit

    preview: 검증 결과만 돌려준다 (저장 안 함)
    commit : 다시 검증한 뒤 오류 없는 행만 한 번에 저장한다
    """
    rack = Rack.objects.get(id=request.POST['rack_id'])
    upload = request.FILES.get('file')
    if not upload:
        raise ValidationError('CSV 파일을 선택해 주세요.')
    if upload.size > 2 * 1024 * 1024:
        raise ValidationError('파일이 너무 큽니다. (최대 2MB)')
    parsed, unknown = parse_csv(upload.read())
    mode = request.POST.get('mode', 'preview')

    with transaction.atomic():
        Rack.objects.select_for_update().filter(id=rack.id).first()
        results = validate_import(rack, parsed)
        valid = [r for r in results if not r['errors']]
        created = 0
        if mode == 'commit':
            for r in valid:
                ServerAsset.objects.create(rack=rack, **r['data'])
                created += 1

    return JsonResponse({
        'mode': mode,
        'rack': {'id': rack.id, 'name': rack.name, 'total_u_space': rack.total_u_space},
        'total': len(results),
        'valid': len(valid),
        'invalid': len(results) - len(valid),
        'created': created,
        'unknown_columns': unknown,
        'rows': [{k: v for k, v in r.items() if k != 'data'} for r in results],
    })


# ---------------------------------------------------------------------------
# 현장 장비 (PM) - 랙 실장도와 별도
# ---------------------------------------------------------------------------
FIELD_ASSET_FIELDS = ('id', 'monday_item_id', 'hostname', 'site_group', 'complex', 'product', 'status',
                      'model_name', 'serial_number', 'ipmi_ip', 'public_ip', 'private_ip', 'ipmi_status',
                      'pm_date', 'pm_status', 'warranty_end', 'health', 'note', 'imported_at',
                      'locally_modified')


@api('GET')
def field_assets(request):
    items = list(FieldAsset.objects.values(*FIELD_ASSET_FIELDS))
    placed = rack_servers_by_field_asset()
    for i in items:
        i['rack'] = rack_link(placed.get(i['id']))
    last = max((i['imported_at'] for i in items if i['imported_at']), default=None)
    unplaced = sum(1 for i in items if not i['rack'])
    return JsonResponse({'items': items, 'last_imported_at': last, 'unplaced': unplaced})


def field_asset_dict(asset):
    d = {f: getattr(asset, f) for f in FIELD_ASSET_FIELDS}
    d['rack'] = rack_link(rack_servers_by_field_asset({asset.id}).get(asset.id))
    return d


@api('POST')
def add_field_asset(request):
    asset = FieldAsset.objects.create(**clean_field_asset(body(request)))
    return JsonResponse(field_asset_dict(asset))


@api('PUT')
def update_field_asset(request, asset_id):
    asset = FieldAsset.objects.get(id=asset_id)
    for k, v in clean_field_asset(body(request), asset).items():
        setattr(asset, k, v)
    with transaction.atomic():
        asset.save()
        sync_rack_server(asset)  # 랙에 배치된 장비면 랙 쪽 값도 같이 바꾼다
    return JsonResponse(field_asset_dict(asset))


@api('POST')
def place_field_assets_view(request):
    """아직 랙에 없는 현장 장비를 랙에 임시 배치. mode=preview 이면 결과만 돌려준다."""
    preview = body(request).get('mode') == 'preview'
    return JsonResponse(place_field_assets(dry_run=preview))


@api('DELETE')
def delete_field_asset(request, asset_id):
    asset = FieldAsset.objects.get(id=asset_id)
    admin = require_admin_confirm(request)
    asset.delete()  # PM 점검 기록도 함께 삭제됨
    return JsonResponse({'message': 'Deleted', 'approved_by': admin.username})


def pm_record_dict(r):
    return {'id': r.id, 'pm_date': r.pm_date, 'pm_status': r.pm_status, 'health': r.health,
            'worker': r.worker, 'note': r.note, 'created_at': r.created_at,
            'created_by': r.created_by.username if r.created_by else ''}


@api('GET', 'POST')
def field_asset_pm_records(request, asset_id):
    asset = FieldAsset.objects.get(id=asset_id)
    if request.method == 'POST':
        data = body(request)
        pm_date = _parse_date(data.get('pm_date'), '점검일')
        if not pm_date:
            raise ValidationError('점검일을 입력해 주세요.')
        status = (data.get('pm_status') or '완료').strip()
        if status not in PMRecord.PM_STATUSES:
            raise ValidationError(f"점검 결과 값이 올바르지 않습니다: '{status}'")
        PMRecord.objects.create(
            asset=asset, pm_date=pm_date, pm_status=status,
            health=clean_health(data.get('health'), FieldAsset.HEALTH_PARTS),
            worker=(data.get('worker') or request.user.username).strip(),
            note=(data.get('note') or '').strip(), created_by=request.user,
        )
        refresh_asset_pm(asset)
    return JsonResponse({
        'asset': field_asset_dict(asset),
        'records': [pm_record_dict(r) for r in asset.pm_records.select_related('created_by')],
    })


@api('DELETE')
def delete_pm_record(request, record_id):
    record = PMRecord.objects.select_related('asset').get(id=record_id)
    asset = record.asset
    record.delete()
    refresh_asset_pm(asset)  # 남은 기록 중 최신 것을 다시 반영
    return JsonResponse({'asset': field_asset_dict(asset)})


@api('GET')
def field_assets_template(request):
    resp = HttpResponse(field_template_csv(), content_type='text/csv; charset=utf-8')
    resp['Content-Disposition'] = 'attachment; filename="field_assets_template.csv"'
    return resp


@api('POST')
def import_field_assets_view(request):
    upload = request.FILES.get('file')
    if not upload:
        raise ValidationError('CSV 파일을 선택해 주세요.')
    if upload.size > 5 * 1024 * 1024:
        raise ValidationError('파일이 너무 큽니다. (최대 5MB)')
    return JsonResponse(import_field_assets(upload.read(), dry_run=request.POST.get('mode') == 'preview'))


@api('GET')
def get_server_history(request, server_id):
    try:
        server = ServerAsset.objects.get(id=server_id)
        
        # 1. DB 마이그레이션이 꼬여있으면 여기서 잡힙니다.
        try:
            histories = list(server.history.all().order_by('-history_date'))
        except Exception as db_err:
            return JsonResponse({'error': f"DB 구조 오류(마이그레이션 필요): {str(db_err)}"}, status=500)

        history_data = []
        for i in range(len(histories)):
            h = histories[i]
            changes = []

            if i + 1 < len(histories):
                prev_h = histories[i + 1]
                try:
                    # 2. JSON 비교 시 오류가 나면 통째로 갱신된 것으로 처리합니다.
                    delta = h.diff_against(prev_h)
                    for change in delta.changes:
                        changes.append({
                            'field': change.field,
                            'old': str(change.old) if change.old else '',
                            'new': str(change.new) if change.new else ''
                        })
                except Exception:
                    changes.append({'field': '데이터 갱신', 'old': '이전 제원', 'new': '새로운 제원으로 변경됨'})
            else:
                changes.append({'field': '최초 등록', 'old': '', 'new': '신규 자산 생성'})

            user_name = 'System'
            try:
                if h.history_user:
                    user_name = h.history_user.username
            except:
                pass

            history_data.append({
                'date': h.history_date.strftime('%Y-%m-%d %H:%M:%S'),
                'user': user_name,
                'type': 'Created' if h.history_type == '+' else 'Updated' if h.history_type == '~' else 'Deleted',
                'changes': changes
            })
            
        return JsonResponse(history_data, safe=False)
    except ServerAsset.DoesNotExist:
        return JsonResponse({'error': '해당 장비를 찾을 수 없습니다.'}, status=404)
    except Exception as e:
        return JsonResponse({'error': f"서버 내부 오류: {str(e)}"}, status=500)
