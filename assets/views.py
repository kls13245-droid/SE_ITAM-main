import json
from functools import wraps
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate, login, logout
from .models import Campus, Building, Rack, ServerAsset

def login_required_api(view):
    @wraps(view)
    def _wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "로그인이 필요합니다."}, status=401)
        return view(request, *args, **kwargs)
    return _wrapped

@csrf_exempt
@login_required_api
def api_site_data(request):
    data = []
    campuses = Campus.objects.all()
    for campus in campuses:
        campus_data = {'id': campus.id, 'name': campus.name, 'buildings': []}
        buildings = Building.objects.filter(campus=campus)
        for building in buildings:
            building_data = {'id': building.id, 'name': building.name, 'racks': []}
            racks = Rack.objects.filter(building=building)
            for rack in racks:
                rack_data = {
                    'id': rack.id, 'name': rack.name, 'location': rack.location,
                    'total_u_space': rack.total_u_space,
                    'servers': list(ServerAsset.objects.filter(rack=rack).values(
                        'id', 'hostname', 'start_u', 'size_u', 'status',
                        'model_name', 'setup_year', 'description', 'specs', 'os_version'
                    ))
                }
                building_data['racks'].append(rack_data)
            campus_data['buildings'].append(building_data)
        data.append(campus_data)
    return JsonResponse(data, safe=False)

@csrf_exempt
@login_required_api
def add_campus(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            campus = Campus.objects.create(name=data['name'])
            return JsonResponse({'id': campus.id, 'name': campus.name, 'buildings': []})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

@csrf_exempt
@login_required_api
def add_building(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            campus = Campus.objects.get(id=data['campus_id'])
            building = Building.objects.create(campus=campus, name=data['name'])
            return JsonResponse({'id': building.id, 'name': building.name, 'racks': []})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

@csrf_exempt
@login_required_api
def add_rack(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            building = Building.objects.get(id=data['building_id'])
            rack = Rack.objects.create(
                building=building, name=data['name'],
                location=data.get('location', ''), total_u_space=data.get('total_u_space', 42)
            )
            return JsonResponse({'id': rack.id, 'name': rack.name, 'location': rack.location, 'total_u_space': rack.total_u_space, 'servers': []})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

@csrf_exempt
@login_required_api
def add_server(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            server = ServerAsset.objects.create(
                rack_id=data['rack_id'],
                hostname=data.get('hostname', ''),
                start_u=data['start_u'],
                size_u=data.get('size_u', 1),
                model_name=data.get('model_name', ''),
                status=data.get('status', 'WAIT'),
                setup_year=data.get('setup_year', ''),
                description=data.get('description', ''),
                specs=data.get('specs', {})
            )
            return JsonResponse({'id': server.id, 'message': 'Success'})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

@csrf_exempt
@login_required_api
def update_server(request, server_id):
    if request.method == 'PUT':
        try:
            data = json.loads(request.body)
            server = ServerAsset.objects.get(id=server_id)
            server.start_u = data.get('start_u', server.start_u)
            server.size_u = data.get('size_u', server.size_u)
            server.hostname = data.get('hostname', server.hostname)
            server.model_name = data.get('model_name', server.model_name)
            server.status = data.get('status', server.status)
            server.setup_year = data.get('setup_year', server.setup_year)
            server.description = data.get('description', server.description)
            server.specs = data.get('specs', server.specs)
            server.save()
            return JsonResponse({'id': server.id, 'message': 'Updated successfully'})
        except ServerAsset.DoesNotExist:
            return JsonResponse({'error': 'Server not found'}, status=404)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

@csrf_exempt
@login_required_api
def delete_server(request, server_id):
    if request.method == 'DELETE':
        try:
            server = ServerAsset.objects.get(id=server_id)
            server.delete()
            return JsonResponse({'message': 'Deleted'})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=400)

# ⭐️ 신규 업데이트: 극강의 예외 처리가 포함된 이력 조회 API
@csrf_exempt
@login_required_api
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
def update_campus(request, campus_id):
    if request.method != 'PUT':
        return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)
    campus = Campus.objects.get(id=campus_id)
    data = json.loads(request.body)
    campus.name = data.get('name', campus.name)
    campus.save()
    return JsonResponse({'id': campus.id, 'name': campus.name})

@csrf_exempt
@login_required_api
def delete_campus(request, campus_id):
    if request.method != 'DELETE':
        return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)
    Campus.objects.get(id=campus_id).delete()
    return JsonResponse({'message': 'Deleted'})

@csrf_exempt
@login_required_api
def update_building(request, building_id):
    if request.method != 'PUT':
        return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)
    building = Building.objects.get(id=building_id)
    data = json.loads(request.body)
    building.name = data.get('name', building.name)
    building.save()
    return JsonResponse({'id': building.id, 'name': building.name})

@csrf_exempt
@login_required_api
def delete_building(request, building_id):
    if request.method != 'DELETE':
        return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)
    Building.objects.get(id=building_id).delete()
    return JsonResponse({'message': 'Deleted'})

@csrf_exempt
@login_required_api
def update_rack(request, rack_id):
    if request.method != 'PUT':
        return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)
    rack = Rack.objects.get(id=rack_id)
    data = json.loads(request.body)
    rack.name = data.get('name', rack.name)
    rack.location = data.get('location', rack.location)
    rack.total_u_space = data.get('total_u_space', rack.total_u_space)
    rack.save()
    return JsonResponse({'id': rack.id, 'name': rack.name, 'location': rack.location, 'total_u_space': rack.total_u_space})

@csrf_exempt
@login_required_api
def delete_rack(request, rack_id):
    if request.method != 'DELETE':
        return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)
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
def import_servers(request):
    if request.method != 'POST':
        return JsonResponse({'error': '잘못된 요청입니다.'}, status=405)
    data = json.loads(request.body)
    rack_id = data.get('rack_id')
    rows = data.get('rows', [])
    created = 0
    for row in rows:
        if not row.get('hostname'):
            continue
        ServerAsset.objects.create(
            rack_id=rack_id,
            hostname=row.get('hostname', ''),
            model_name=row.get('model_name', ''),
            status=row.get('status') or 'WAIT',
            start_u=int(row.get('start_u') or 1),
            size_u=int(row.get('size_u') or guess_size_u(row.get('model_name'))),
            specs={
                'power_w': row.get('power_w', ''),
                'public_ip': row.get('public_ip', ''),
                'private_ip': row.get('private_ip', ''),
                'mgmt_ip': row.get('mgmt_ip', ''),
            }
        )
        created += 1
    return JsonResponse({'created': created})
