import json
from functools import wraps
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Prefetch
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate, login, logout
from simple_history.utils import bulk_create_with_history
from .models import Campus, Building, Rack, ServerAsset

SERVER_FIELDS = (
    'id', 'hostname', 'start_u', 'size_u', 'status',
    'model_name', 'setup_year', 'description', 'specs', 'os_version',
)


def login_required_api(view):
    @wraps(view)
    def _wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "로그인이 필요합니다."}, status=401)
        return view(request, *args, **kwargs)
    return _wrapped


def api_method(method):
    """허용된 HTTP 메서드만 받고, 없는 ID·잘못된 입력을 JSON 오류(404/400)로 돌려줍니다."""
    def decorator(view):
        @wraps(view)
        def _wrapped(request, *args, **kwargs):
            if request.method != method:
                return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)
            try:
                return view(request, *args, **kwargs)
            except ObjectDoesNotExist:
                return JsonResponse({'error': '대상을 찾을 수 없습니다.'}, status=404)
            except (ValueError, TypeError, KeyError) as e:  # JSONDecodeError는 ValueError의 하위 클래스
                return JsonResponse({'error': f'잘못된 입력입니다: {e}'}, status=400)
        return _wrapped
    return decorator


def find_placement_error(rack, start_u, size_u, exclude_id=None):
    """랙 범위 초과나 다른 장비와의 U 겹침이 있으면 오류 메시지를, 없으면 None을 돌려줍니다."""
    if rack is None or start_u in (None, ''):
        return None
    start = int(start_u)
    size = int(size_u or 1)
    end = start + size - 1
    if start < 1:
        return '유효한 시작 U 위치를 입력하세요.'
    if end > rack.total_u_space:
        return f'장비가 랙의 최대 높이({rack.total_u_space}U)를 벗어납니다.'
    others = ServerAsset.objects.filter(rack=rack, start_u__isnull=False).exclude(id=exclude_id)
    for other in others.only('id', 'hostname', 'model_name', 'start_u', 'size_u'):
        other_end = other.start_u + (other.size_u or 1) - 1
        if start <= other_end and end >= other.start_u:
            name = other.hostname or other.model_name or '이름 없음'
            return f'[{name}] 장비(U{other.start_u}~U{other_end})와 위치가 겹칩니다.'
    return None


@csrf_exempt
@login_required_api
def api_site_data(request):
    # 캠퍼스·건물·랙·서버를 각각 한 번씩, 총 4번의 쿼리로 가져옵니다 (기존: 랙 수에 비례).
    campuses = Campus.objects.prefetch_related(
        'buildings__racks',
        Prefetch('buildings__racks__servers', queryset=ServerAsset.objects.only(*SERVER_FIELDS, 'rack')),
    )
    data = []
    for campus in campuses:
        campus_data = {'id': campus.id, 'name': campus.name, 'buildings': []}
        for building in campus.buildings.all():
            building_data = {'id': building.id, 'name': building.name, 'racks': []}
            for rack in building.racks.all():
                building_data['racks'].append({
                    'id': rack.id, 'name': rack.name, 'location': rack.location,
                    'total_u_space': rack.total_u_space,
                    'servers': [{f: getattr(s, f) for f in SERVER_FIELDS} for s in rack.servers.all()],
                })
            campus_data['buildings'].append(building_data)
        data.append(campus_data)
    return JsonResponse(data, safe=False)

@csrf_exempt
@login_required_api
@api_method('POST')
def add_campus(request):
    data = json.loads(request.body)
    campus = Campus.objects.create(name=data['name'])
    return JsonResponse({'id': campus.id, 'name': campus.name, 'buildings': []})

@csrf_exempt
@login_required_api
@api_method('POST')
def add_building(request):
    data = json.loads(request.body)
    campus = Campus.objects.get(id=data['campus_id'])
    building = Building.objects.create(campus=campus, name=data['name'])
    return JsonResponse({'id': building.id, 'name': building.name, 'racks': []})

@csrf_exempt
@login_required_api
@api_method('POST')
def add_rack(request):
    data = json.loads(request.body)
    building = Building.objects.get(id=data['building_id'])
    rack = Rack.objects.create(
        building=building, name=data['name'],
        location=data.get('location', ''), total_u_space=data.get('total_u_space', 42)
    )
    return JsonResponse({'id': rack.id, 'name': rack.name, 'location': rack.location, 'total_u_space': rack.total_u_space, 'servers': []})

def _os_version_from(data, default=''):
    """프론트는 OS 버전을 specs.os_version에 담아 보내므로, 관리자 화면 검색용 os_version 컬럼에도 맞춰 저장합니다."""
    specs = data.get('specs') or {}
    return data.get('os_version') or specs.get('os_version') or default

@csrf_exempt
@login_required_api
@api_method('POST')
def add_server(request):
    data = json.loads(request.body)
    rack = Rack.objects.get(id=data['rack_id'])
    size_u = data.get('size_u', 1)
    error = find_placement_error(rack, data['start_u'], size_u)
    if error:
        return JsonResponse({'error': error}, status=409)
    server = ServerAsset.objects.create(
        rack=rack,
        hostname=data.get('hostname', ''),
        start_u=data['start_u'],
        size_u=size_u,
        model_name=data.get('model_name', ''),
        status=data.get('status', 'WAIT'),
        setup_year=data.get('setup_year', ''),
        description=data.get('description', ''),
        os_version=_os_version_from(data),
        specs=data.get('specs', {})
    )
    return JsonResponse({'id': server.id, 'message': 'Success'})

@csrf_exempt
@login_required_api
@api_method('PUT')
def update_server(request, server_id):
    data = json.loads(request.body)
    server = ServerAsset.objects.select_related('rack').get(id=server_id)
    new_start = data.get('start_u', server.start_u)
    new_size = data.get('size_u', server.size_u)
    # 위치가 바뀔 때만 검증합니다 (기존에 겹쳐 있던 데이터도 이름·제원 수정은 계속 가능하도록).
    if str(new_start) != str(server.start_u) or str(new_size) != str(server.size_u):
        error = find_placement_error(server.rack, new_start, new_size, exclude_id=server.id)
        if error:
            return JsonResponse({'error': error}, status=409)
    server.start_u = new_start
    server.size_u = new_size
    server.hostname = data.get('hostname', server.hostname)
    server.model_name = data.get('model_name', server.model_name)
    server.status = data.get('status', server.status)
    server.setup_year = data.get('setup_year', server.setup_year)
    server.description = data.get('description', server.description)
    server.os_version = _os_version_from(data, server.os_version)
    server.specs = data.get('specs', server.specs)
    server.save()
    return JsonResponse({'id': server.id, 'message': 'Updated successfully'})

@csrf_exempt
@login_required_api
@api_method('DELETE')
def delete_server(request, server_id):
    ServerAsset.objects.get(id=server_id).delete()
    return JsonResponse({'message': 'Deleted'})

# ⭐️ 신규 업데이트: 극강의 예외 처리가 포함된 이력 조회 API
@csrf_exempt
@login_required_api
def get_server_history(request, server_id):
    try:
        server = ServerAsset.objects.get(id=server_id)
        
        # 1. DB 마이그레이션이 꼬여있으면 여기서 잡힙니다.
        try:
            # history_user를 함께 가져와 이력마다 사용자 조회 쿼리가 따로 나가지 않게 합니다.
            histories = list(server.history.select_related('history_user').order_by('-history_date'))
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

@csrf_exempt
def api_login(request):
    """리액트 프론트엔드에서 넘어온 ID/PW를 장고 Admin 계정으로 검증하는 API"""
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            username = data.get('username')
            password = data.get('password')
            
            # 장고에 기본 내장된 함수로 DB에 있는 Admin 계정인지 검증합니다.
            user = authenticate(username=username, password=password)
            
            if user is not None:
                login(request, user) # 세션 생성
                return JsonResponse({'success': True, 'username': user.username})
            else:
                return JsonResponse({'error': '아이디 또는 비밀번호가 틀렸습니다.'}, status=401)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)
            
    return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)

@csrf_exempt
def api_logout(request):
    logout(request)
    return JsonResponse({"success": True})

@csrf_exempt
def api_me(request):
    if request.user.is_authenticated:
        return JsonResponse({"authenticated": True, "username": request.user.username})
    return JsonResponse({"authenticated": False}, status=401)

@csrf_exempt
@login_required_api
@api_method('PUT')
def update_campus(request, campus_id):
    campus = Campus.objects.get(id=campus_id)
    data = json.loads(request.body)
    campus.name = data.get('name', campus.name)
    campus.save()
    return JsonResponse({'id': campus.id, 'name': campus.name})

@csrf_exempt
@login_required_api
@api_method('DELETE')
def delete_campus(request, campus_id):
    Campus.objects.get(id=campus_id).delete()
    return JsonResponse({'message': 'Deleted'})

@csrf_exempt
@login_required_api
@api_method('PUT')
def update_building(request, building_id):
    building = Building.objects.get(id=building_id)
    data = json.loads(request.body)
    building.name = data.get('name', building.name)
    building.save()
    return JsonResponse({'id': building.id, 'name': building.name})

@csrf_exempt
@login_required_api
@api_method('DELETE')
def delete_building(request, building_id):
    Building.objects.get(id=building_id).delete()
    return JsonResponse({'message': 'Deleted'})

@csrf_exempt
@login_required_api
@api_method('PUT')
def update_rack(request, rack_id):
    rack = Rack.objects.get(id=rack_id)
    data = json.loads(request.body)
    rack.name = data.get('name', rack.name)
    rack.location = data.get('location', rack.location)
    rack.total_u_space = data.get('total_u_space', rack.total_u_space)
    rack.save()
    return JsonResponse({'id': rack.id, 'name': rack.name, 'location': rack.location, 'total_u_space': rack.total_u_space})

@csrf_exempt
@login_required_api
@api_method('DELETE')
def delete_rack(request, rack_id):
    Rack.objects.get(id=rack_id).delete()
    return JsonResponse({'message': 'Deleted'})

MODEL_SIZE_MAP = [
    ("R760XA", 2), ("R760", 2), ("R660XS", 1), ("R660", 1), ("R7715", 2), ("R470", 1), ("R360", 1),
    ("DL380", 2), ("DL360", 1), ("DL320", 1), ("DL20", 1),
    ("A400", 4), ("A250", 2), ("FAS2820", 2), ("FAS7200", 6),
    ("UNITY380", 2), ("POWERSCALE", 4), ("H700", 4), ("X20", 3),
    ("MDS9148", 1), ("MDS9132", 1), ("S5148", 1), ("S4148", 1), ("S5248", 1), ("S3248", 1),
    ("JL814A", 1), ("7010TX", 1), ("7050SX", 1), ("THUNDER", 1), ("CL5716", 1),
    ("R650", 1), ("R750", 2), ("R2500", 1), ("EF300", 2), ("KVM", 1),
]

def guess_size_u(model_name):
    name = (model_name or "").upper().replace(" ", "").replace("-", "").replace("_", "")
    for key, size in MODEL_SIZE_MAP:
        if key in name:
            return size
    return 1

@csrf_exempt
@login_required_api
@api_method('POST')
def import_servers(request):
    data = json.loads(request.body)
    rack = Rack.objects.get(id=data.get('rack_id'))
    servers = []
    for line_no, row in enumerate(data.get('rows', []), start=2):  # 1행은 CSV 헤더
        if not row.get('hostname'):
            continue
        try:
            start_u = int(row.get('start_u') or 1)
            size_u = int(row.get('size_u') or guess_size_u(row.get('model_name')))
        except (TypeError, ValueError):
            return JsonResponse({'error': f'{line_no}행 [{row.get("hostname")}]: U 위치/크기가 숫자가 아닙니다.'}, status=400)
        servers.append(ServerAsset(
            rack=rack,
            hostname=row.get('hostname', ''),
            model_name=row.get('model_name', ''),
            status=row.get('status') or 'WAIT',
            start_u=start_u,
            size_u=size_u,
            specs={
                'power_w': row.get('power_w', ''),
                'public_ip': row.get('public_ip', ''),
                'private_ip': row.get('private_ip', ''),
                'mgmt_ip': row.get('mgmt_ip', ''),
            }
        ))
    # 한 번에 일괄 저장하고(행마다 INSERT 2번 → 묶음 처리), 중간에 실패하면 전부 되돌립니다.
    # 변경 이력도 함께 남기고, 가져온 사용자를 이력 작성자로 기록합니다.
    with transaction.atomic():
        bulk_create_with_history(servers, ServerAsset, default_user=request.user)
    return JsonResponse({'created': len(servers)})
