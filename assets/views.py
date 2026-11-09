import json
from functools import wraps

from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Prefetch
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Building, Campus, Rack, ServerAsset
from .services import (
    ValidationError, parse_csv, template_csv, to_int, validate_import, validate_server_payload,
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
            except (json.JSONDecodeError, KeyError, TypeError, ValueError) as e:
                return error(f'요청 형식이 올바르지 않습니다: {e}', 400)
        return wrapped
    return decorator


def body(request):
    return json.loads(request.body or b'{}')


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
    return JsonResponse({'success': True, 'username': user.username, 'csrf_token': get_token(request)})


@api('POST', auth=False)
def api_logout(request):
    logout(request)
    return JsonResponse({'success': True})


@api('GET', auth=False)
def api_me(request):
    if request.user.is_authenticated:
        return JsonResponse({'authenticated': True, 'username': request.user.username})
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
    count = ServerAsset.objects.filter(rack__building__campus=campus).count()
    if count:
        return error(f'이 캠퍼스의 랙에 장비 {count}대가 남아 있어 삭제할 수 없습니다. 장비를 먼저 옮기거나 삭제해 주세요.', 409, server_count=count)
    campus.delete()
    return JsonResponse({'message': 'Deleted'})


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
    count = ServerAsset.objects.filter(rack__building=building).count()
    if count:
        return error(f'이 건물의 랙에 장비 {count}대가 남아 있어 삭제할 수 없습니다. 장비를 먼저 옮기거나 삭제해 주세요.', 409, server_count=count)
    building.delete()
    return JsonResponse({'message': 'Deleted'})


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
    count = rack.servers.count()
    if count:
        return error(f'이 랙에 장비 {count}대가 남아 있어 삭제할 수 없습니다. 장비를 먼저 옮기거나 삭제해 주세요.', 409, server_count=count)
    rack.delete()
    return JsonResponse({'message': 'Deleted'})


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
    ServerAsset.objects.get(id=server_id).delete()
    return JsonResponse({'message': 'Deleted'})


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
