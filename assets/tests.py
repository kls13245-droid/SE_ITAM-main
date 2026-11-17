import json

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from .models import Building, Campus, FieldAsset, PMRecord, Rack, ServerAsset


class BaseTest(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()  # 관리자 비밀번호 실패 횟수 초기화
        User.objects.create_user('admin', password='pw')  # 일반 사용자 (화면 로그인용)
        User.objects.create_user('boss', password='bosspw', is_staff=True)  # 삭제 승인용 관리자
        # 실제 화면처럼 CSRF 검사를 켠 클라이언트
        self.c = Client(enforce_csrf_checks=True)
        self.token = self.c.get('/api/csrf/').json()['csrf_token']
        r = self.post('/api/login/', {'username': 'admin', 'password': 'pw'})
        self.token = r.json()['csrf_token']
        self.campus = Campus.objects.create(name='기흥')
        self.building = Building.objects.create(campus=self.campus, name='S1')
        self.rack = Rack.objects.create(building=self.building, name='R01', total_u_space=42)

    def post(self, url, data):
        return self.c.post(url, json.dumps(data), content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def put(self, url, data):
        return self.c.put(url, json.dumps(data), content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def delete(self, url, admin=('boss', 'bosspw')):
        payload = {'admin_username': admin[0], 'admin_password': admin[1]} if admin else {}
        return self.c.delete(url, json.dumps(payload), content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def add(self, hostname, start_u, size_u=1, **kw):
        return self.post('/api/server/add/', {'rack_id': self.rack.id, 'hostname': hostname,
                                              'start_u': start_u, 'size_u': size_u, **kw})

    def upload(self, text, mode='preview'):
        f = SimpleUploadedFile('a.csv', text.encode('utf-8-sig'), content_type='text/csv')
        return self.c.post('/api/server/import/', {'rack_id': self.rack.id, 'mode': mode, 'file': f},
                           HTTP_X_CSRFTOKEN=self.token)


class CsrfTest(BaseTest):
    def test_post_without_token_is_rejected(self):
        r = self.c.post('/api/campus/add/', json.dumps({'name': 'x'}), content_type='application/json')
        self.assertEqual(r.status_code, 403)
        self.assertFalse(Campus.objects.filter(name='x').exists())

    def test_post_with_token_works(self):
        self.assertEqual(self.post('/api/campus/add/', {'name': 'x'}).status_code, 200)


class PlacementTest(BaseTest):
    def test_overlap_rejected(self):
        self.assertEqual(self.add('a', 10, 2).status_code, 200)
        r = self.add('b', 11, 1)
        self.assertEqual(r.status_code, 400)
        self.assertIn('겹칩니다', r.json()['error'])

    def test_out_of_rack_rejected(self):
        r = self.add('a', 42, 2)
        self.assertEqual(r.status_code, 400)
        self.assertIn('42U', r.json()['error'])

    def test_duplicate_hostname_rejected_case_insensitive(self):
        self.add('web01', 1)
        r = self.add('WEB01', 5)
        self.assertEqual(r.status_code, 400)

    def test_update_can_keep_own_position(self):
        sid = self.add('a', 10, 2).json()['id']
        r = self.put(f'/api/server/update/{sid}/', {'start_u': 11, 'size_u': 2})
        self.assertEqual(r.status_code, 200)

    def test_update_into_other_server_rejected(self):
        self.add('a', 10, 2)
        sid = self.add('b', 20).json()['id']
        r = self.put(f'/api/server/update/{sid}/', {'start_u': 11})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(ServerAsset.objects.get(id=sid).start_u, 20)

    def test_missing_object_returns_json_404(self):
        r = self.put('/api/server/update/9999/', {'start_u': 1})
        self.assertEqual(r.status_code, 404)
        self.assertIn('error', r.json())

    def test_invalid_ip_rejected(self):
        r = self.add('a', 1, specs={'public_ip': '999.1.1.1'})
        self.assertEqual(r.status_code, 400)

    def test_rack_cannot_shrink_below_servers(self):
        self.add('a', 40, 2)
        r = self.put(f'/api/rack/update/{self.rack.id}/', {'total_u_space': 40})
        self.assertEqual(r.status_code, 400)


class OsVersionTest(BaseTest):
    def test_os_version_from_specs_saved_to_field(self):
        sid = self.add('a', 1, specs={'os_version': 'Ubuntu 22.04'}).json()['id']
        s = ServerAsset.objects.get(id=sid)
        self.assertEqual(s.os_version, 'Ubuntu 22.04')
        self.put(f'/api/server/update/{sid}/', {'specs': {'os_version': 'RHEL 9'}})
        s.refresh_from_db()
        self.assertEqual((s.os_version, s.specs['os_version']), ('RHEL 9', 'RHEL 9'))


class AdminDeleteTest(BaseTest):
    def test_delete_requires_admin_credentials(self):
        sid = self.add('a', 1).json()['id']
        url = f'/api/server/delete/{sid}/'
        self.assertEqual(self.delete(url, admin=None).status_code, 403)
        self.assertEqual(self.delete(url, admin=('boss', 'wrong')).status_code, 403)
        r = self.delete(url, admin=('admin', 'pw'))  # 비밀번호는 맞지만 관리자 아님
        self.assertEqual(r.status_code, 403)
        self.assertIn('관리자 권한', r.json()['error'])
        self.assertTrue(ServerAsset.objects.filter(id=sid).exists())
        r = self.delete(url)
        self.assertEqual((r.status_code, r.json()['approved_by']), (200, 'boss'))
        self.assertFalse(ServerAsset.objects.filter(id=sid).exists())

    def test_rack_building_campus_delete_removes_servers(self):
        self.add('a', 1); self.add('b', 5)
        r = self.delete(f'/api/rack/delete/{self.rack.id}/')
        self.assertEqual((r.status_code, r.json()['deleted_servers']), (200, 2))
        self.assertEqual(ServerAsset.objects.count(), 0)  # 미실장으로 남지 않음
        rack2 = Rack.objects.create(building=self.building, name='R2')
        ServerAsset.objects.create(rack=rack2, hostname='c', model_name='m', start_u=1)
        self.assertEqual(self.delete(f'/api/campus/delete/{self.campus.id}/').json()['deleted_servers'], 1)
        self.assertEqual((Campus.objects.count(), Building.objects.count(), Rack.objects.count(), ServerAsset.objects.count()), (0, 0, 0, 0))

    def test_wrong_password_does_not_delete_campus(self):
        self.add('a', 1)
        self.assertEqual(self.delete(f'/api/campus/delete/{self.campus.id}/', admin=('boss', 'x')).status_code, 403)
        self.assertEqual(ServerAsset.objects.count(), 1)

    def test_lockout_after_repeated_failures(self):
        from django.core.cache import cache
        cache.clear()
        url = f'/api/rack/delete/{self.rack.id}/'
        for _ in range(5):
            self.delete(url, admin=('boss', 'x'))
        r = self.delete(url)  # 맞는 비밀번호도 잠시 막힘
        self.assertEqual(r.status_code, 403)
        self.assertIn('5분', r.json()['error'])
        cache.clear()

    def test_pm_record_delete_needs_no_password(self):
        a = FieldAsset.objects.create(hostname='x')
        rec = PMRecord.objects.create(asset=a, pm_date='2026-11-01')
        self.assertEqual(self.delete(f'/api/field-assets/pm/delete/{rec.id}/', admin=None).status_code, 200)


class CsvImportTest(BaseTest):
    HEADER = 'hostname,model_name,status,start_u,size_u,power_w,public_lan,private_lan,public_ip,virtual_ip,private_ip,mgmt_ip,os_version\n'

    def test_preview_does_not_save(self):
        r = self.upload(self.HEADER + 'a,R660,OPER,1,1,800,2,2,1.1.1.1,,10.0.0.1,10.9.0.1,Ubuntu\n')
        self.assertEqual(r.json()['valid'], 1)
        self.assertEqual(ServerAsset.objects.count(), 0)

    def test_commit_saves_all_fields(self):
        r = self.upload(self.HEADER + 'a,R660,OPER,1,1,800W,2,4,"1.1.1.1, 1.1.1.2",2.2.2.2;2.2.2.3,10.0.0.1,10.9.0.1,Ubuntu 22.04\n', 'commit')
        self.assertEqual(r.json()['created'], 1)
        s = ServerAsset.objects.get(hostname='a')
        self.assertEqual(s.specs['power_w'], '800')
        self.assertEqual(s.specs['public_lan'], '2')
        self.assertEqual(s.specs['private_lan'], '4')
        self.assertEqual(s.specs['public_ip'], '1.1.1.1, 1.1.1.2')
        self.assertEqual(s.specs['virtual_ip'], '2.2.2.2, 2.2.2.3')
        self.assertEqual(s.os_version, 'Ubuntu 22.04')

    def test_errors_reported_and_only_valid_rows_saved(self):
        csv = self.HEADER + (
            'ok1,R660,OPER,1,1,,,,,,,,\n'
            'dup,R660,OPER,1,1,,,,,,,,\n'        # ok1과 U 겹침
            'ok1,R660,OPER,5,1,,,,,,,,\n'        # 파일 안 호스트명 중복
            'bad,R660,XXX,10,1,,,,,,,,\n'        # 상태값 오류
            'tall,R660,OPER,42,2,,,,,,,,\n'      # 랙 초과
            'nou,R660,OPER,,1,,,,,,,,\n'         # start_u 없음
            'ip,R660,OPER,20,1,,,,999.0.0.1,,,,\n'  # IP 오류
            'ok2,R760,운영,30,,,,,,,,,\n'         # 한글 상태 + size 추정
        )
        r = self.upload(csv, 'commit').json()
        self.assertEqual((r['total'], r['valid'], r['created']), (8, 2, 2))
        self.assertEqual(sorted(ServerAsset.objects.values_list('hostname', flat=True)), ['ok1', 'ok2'])
        ok2 = ServerAsset.objects.get(hostname='ok2')
        self.assertEqual((ok2.status, ok2.size_u), ('OPER', 2))
        for row in r['rows'][1:7]:
            self.assertTrue(row['errors'], row)

    def test_existing_hostname_skipped(self):
        self.add('a', 30)
        r = self.upload(self.HEADER + 'a,R660,OPER,1,1,,,,,,,,\n', 'commit').json()
        self.assertEqual(r['created'], 0)

    def test_duplicate_ip_is_warning(self):
        self.add('a', 30, specs={'private_ip': '10.0.0.1'})
        r = self.upload(self.HEADER + 'b,R660,OPER,1,1,,,,,,10.0.0.1,,\n').json()
        self.assertEqual(r['valid'], 1)
        self.assertTrue(r['rows'][0]['warnings'])

    def test_old_template_and_korean_headers(self):
        old = 'hostname,model_name,status,start_u,size_u,power_w,public_ip,private_ip,mgmt_ip\nx,R660,OPER,1,1,800,,,\n'
        self.assertEqual(self.upload(old).json()['valid'], 1)
        ko = '호스트명,모델명,상태,시작U,전력\ny,R660,운영,3,500\n'
        self.assertEqual(self.upload(ko).json()['valid'], 1)

    def test_cp949_file(self):
        text = '호스트명,모델명,시작U,설명\nz,R660,1,웹서버\n'
        f = SimpleUploadedFile('a.csv', text.encode('cp949'), content_type='text/csv')
        r = self.c.post('/api/server/import/', {'rack_id': self.rack.id, 'mode': 'commit', 'file': f},
                        HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(r.json()['created'], 1)
        self.assertEqual(ServerAsset.objects.get(hostname='z').description, '웹서버')

    def test_template_download_can_be_imported(self):
        tpl = self.c.get('/api/server/import/template/').content.decode('utf-8-sig')
        r = self.upload(tpl).json()
        self.assertEqual(r['valid'], 1, r)


class SiteDataTest(BaseTest):
    def test_site_data_query_count_is_constant(self):
        for i in range(5):
            r = Rack.objects.create(building=self.building, name=f'R{i}')
            ServerAsset.objects.create(rack=r, hostname=f'h{i}', model_name='m', start_u=1)
        with self.assertNumQueries(6):  # 세션 + 사용자 + 4개 조회
            self.c.get('/api/site-data/')


class FieldAssetTest(BaseTest):
    CSV = ('monday ID,Hostname,그룹(현장/제품),단지,제품명,상태,Model,S/N,IPMI IP,Public IP,Private IP,IPMI 상태,'
           'PM 날짜,PM 상태,워런티 종료,CPU,Memory,Network,DISK,Fans,Cache Battery,비고\n'
           '111,ControlPC,1L DM,Foundry,DM,가동,DL20 Gen10,SN1,100.100.110.1,12.0.0.1,100.100.100.1,접속 가능,2026-03-16,완료,,정상,정상,정상,Fault,정상,정상,디스크 교체\n'
           '222,ControlPC,S5 DAQ,Memory,DAQ,확인 필요,,,,,100.100.100.1,접속 불가,,,,,,,,,,\n')

    def upload_field(self, text, mode='commit'):
        f = SimpleUploadedFile('pm.csv', text.encode('utf-8-sig'), content_type='text/csv')
        return self.c.post('/api/field-assets/import/', {'file': f, 'mode': mode}, HTTP_X_CSRFTOKEN=self.token)

    def test_import_allows_same_hostname_and_ip_across_sites(self):
        r = self.upload_field(self.CSV).json()
        self.assertEqual((r['created'], r['updated'], len(r['errors'])), (2, 0, 0))
        a = FieldAsset.objects.get(monday_item_id='111')
        self.assertEqual(a.health['disk'], 'Fault')
        self.assertEqual(str(a.pm_date), '2026-03-16')
        self.assertIsNone(a.warranty_end)

    def test_reimport_updates_by_monday_id(self):
        self.upload_field(self.CSV)
        r = self.upload_field(self.CSV.replace('확인 필요', '가동')).json()
        self.assertEqual((r['created'], r['updated']), (0, 2))
        self.assertEqual(FieldAsset.objects.count(), 2)
        self.assertEqual(FieldAsset.objects.get(monday_item_id='222').status, '가동')

    def test_preview_does_not_save(self):
        r = self.upload_field(self.CSV, mode='preview').json()
        self.assertEqual(r['created'], 2)
        self.assertEqual(FieldAsset.objects.count(), 0)

    def test_bad_date_reported(self):
        r = self.upload_field(self.CSV.replace('2026-03-16', '3월16일')).json()
        self.assertEqual(len(r['errors']), 1)
        self.assertEqual(r['created'], 1)

    def test_list_requires_login_and_returns_items(self):
        self.upload_field(self.CSV)
        data = self.c.get('/api/field-assets/').json()
        self.assertEqual(len(data['items']), 2)
        self.assertIsNotNone(data['last_imported_at'])
        self.assertEqual(Client().get('/api/field-assets/').status_code, 401)

    def test_field_assets_do_not_appear_in_rack_data(self):
        self.upload_field(self.CSV)
        self.assertNotIn('ControlPC', self.c.get('/api/site-data/').content.decode())


class FieldAssetEditTest(FieldAssetTest):
    def test_add_and_edit_asset(self):
        r = self.post('/api/field-assets/add/', {'hostname': 'NEW-01', 'site_group': 'P4 DM', 'status': '가동',
                                                 'ipmi_ip': '10.0.0.5', 'health': {'disk': '정상'}})
        self.assertEqual(r.status_code, 200, r.content)
        a = FieldAsset.objects.get(hostname='NEW-01')
        self.assertTrue(a.locally_modified)
        self.assertIsNone(a.monday_item_id)
        r = self.put(f'/api/field-assets/update/{a.id}/', {'status': 'Parts 교체 필요', 'note': '팬 교체 예정'})
        a.refresh_from_db()
        self.assertEqual((a.status, a.note, a.ipmi_ip), ('Parts 교체 필요', '팬 교체 예정', '10.0.0.5'))

    def test_edit_validation(self):
        self.upload_field(self.CSV)
        a = FieldAsset.objects.get(monday_item_id='111')
        self.assertEqual(self.put(f'/api/field-assets/update/{a.id}/', {'hostname': ''}).status_code, 400)
        self.assertEqual(self.put(f'/api/field-assets/update/{a.id}/', {'status': '아무거나'}).status_code, 400)
        self.assertEqual(self.put(f'/api/field-assets/update/{a.id}/', {'public_ip': '999.1.1.1'}).status_code, 400)
        self.assertEqual(self.put(f'/api/field-assets/update/{a.id}/', {'pm_date': '내일'}).status_code, 400)
        # monday에서 온 값을 그대로 다시 보내는 건 허용 (형식 검사는 바뀐 값만)
        self.assertEqual(self.put(f'/api/field-assets/update/{a.id}/', {'public_ip': a.public_ip, 'note': 'x'}).status_code, 200)

    def test_reimport_keeps_local_edits(self):
        self.upload_field(self.CSV)
        a = FieldAsset.objects.get(monday_item_id='111')
        self.put(f'/api/field-assets/update/{a.id}/', {'status': '폐기'})
        r = self.upload_field(self.CSV).json()
        self.assertEqual((r['updated'], r['kept']), (1, 1))
        a.refresh_from_db()
        self.assertEqual(a.status, '폐기')

    def test_pm_record_updates_asset_with_latest(self):
        self.upload_field(self.CSV)
        a = FieldAsset.objects.get(monday_item_id='111')
        url = f'/api/field-assets/{a.id}/pm/'
        r = self.post(url, {'pm_date': '2026-11-01', 'pm_status': '확인 필요',
                            'health': {'disk': 'Fault', 'fans': '정상'}, 'note': '디스크 경고'})
        self.assertEqual(r.status_code, 200, r.content)
        rec = r.json()['records'][0]
        self.assertEqual((rec['worker'], rec['created_by']), ('admin', 'admin'))
        # 더 예전 날짜의 기록을 추가해도 최신 기록 기준 유지
        self.post(url, {'pm_date': '2025-01-01', 'pm_status': '완료'})
        a.refresh_from_db()
        self.assertEqual((str(a.pm_date), a.pm_status, a.health['disk']), ('2026-11-01', '확인 필요', 'Fault'))
        self.assertTrue(a.locally_modified)
        # 최신 기록을 지우면 그다음 기록이 반영됨
        latest_id = PMRecord.objects.get(pm_date='2026-11-01').id
        self.delete(f'/api/field-assets/pm/delete/{latest_id}/')
        a.refresh_from_db()
        self.assertEqual((str(a.pm_date), a.pm_status), ('2025-01-01', '완료'))

    def test_pm_record_validation(self):
        self.upload_field(self.CSV)
        a = FieldAsset.objects.get(monday_item_id='111')
        url = f'/api/field-assets/{a.id}/pm/'
        self.assertEqual(self.post(url, {'pm_status': '완료'}).status_code, 400)
        self.assertEqual(self.post(url, {'pm_date': '2026-11-01', 'pm_status': '대충'}).status_code, 400)
        self.assertEqual(self.post(url, {'pm_date': '2026-11-01', 'health': {'cpu': '고장'}}).status_code, 400)

    def test_delete_asset_removes_records(self):
        self.upload_field(self.CSV)
        a = FieldAsset.objects.get(monday_item_id='111')
        self.post(f'/api/field-assets/{a.id}/pm/', {'pm_date': '2026-11-01'})
        self.assertEqual(self.delete(f'/api/field-assets/delete/{a.id}/').status_code, 200)
        self.assertEqual(PMRecord.objects.count(), 0)


class AutoPlaceTest(BaseTest):
    def setUp(self):
        super().setUp()
        mk = lambda **kw: FieldAsset.objects.create(**{'complex': 'Memory', 'product': 'DM', 'status': '가동', **kw})
        mk(hostname='P1D-DBA', site_group='P1D DM', model_name='DL380 Gen9', ipmi_ip='100.100.110.1', serial_number='SN1')
        mk(hostname='ControlPC', site_group='P1D DM', model_name='DL20 Gen10', public_ip='10.1.1.1(2)')
        mk(hostname='ControlPC', site_group='P2D DM', status='Parts 교체 필요')
        mk(hostname='ControlPC', site_group='P2D DM')  # 같은 현장에 같은 이름
        mk(hostname='Pure Storage', site_group='P1D MiDEWS', product='MiDEWS', status='')

    def test_site_from_group(self):
        from .services import site_from_group
        self.assertEqual(site_from_group('P1D MiDEWS'), 'P1D')
        self.assertEqual(site_from_group('1L , 2L ,6L DM'), '1L, 2L, 6L')
        self.assertEqual(site_from_group('P4  DMM 25'), 'P4')
        self.assertEqual(site_from_group('천안WP(C3) DAQ'), '천안WP(C3)')
        self.assertEqual(site_from_group('S5 MI-MCA'), 'S5')

    def test_place_creates_topology_and_servers(self):
        from .services import place_field_assets
        r = place_field_assets()
        self.assertEqual(r['placed'], 5)
        p1d = Building.objects.get(campus__name='Memory', name='P1D')
        dm = Rack.objects.get(building=p1d, name='DM-RACK-01')
        servers = list(dm.servers.order_by('start_u'))
        self.assertEqual([(s.hostname, s.start_u, s.size_u) for s in servers], [('ControlPC', 1, 1), ('P1D-DBA', 2, 2)])
        dba = servers[1]
        self.assertEqual((dba.status, dba.specs['mgmt_ip'], dba.specs['serial_number']), ('OPER', '100.100.110.1', 'SN1'))
        # 잘못된 IP는 비우고 설명에 원래 값
        self.assertEqual(servers[0].specs['public_ip'], '')
        self.assertIn('10.1.1.1(2)', servers[0].description)
        # 다른 현장의 같은 이름은 그대로, 같은 현장 중복만 번호
        p2d_names = sorted(ServerAsset.objects.filter(rack__building__name='P2D').values_list('hostname', flat=True))
        self.assertEqual(p2d_names, ['ControlPC', 'ControlPC (2)'])
        self.assertEqual(ServerAsset.objects.get(hostname='Pure Storage').specs['asset_type'], 'storage')
        self.assertEqual(ServerAsset.objects.get(hostname='Pure Storage').status, 'WAIT')

    def test_place_is_idempotent_and_dry_run(self):
        from .services import place_field_assets
        self.assertEqual(place_field_assets(dry_run=True)['placed'], 5)
        self.assertEqual(ServerAsset.objects.count(), 0)
        place_field_assets()
        r = place_field_assets()
        self.assertEqual((r['placed'], r['skipped_already']), (0, 5))
        self.assertEqual(ServerAsset.objects.count(), 5)

    def test_rack_overflow_creates_next_rack(self):
        from .services import place_field_assets
        for i in range(25):
            FieldAsset.objects.create(hostname=f'DB{i:02d}', site_group='P9 DM', complex='Memory', product='DM', model_name='DL380 Gen9')
        place_field_assets()
        racks = Rack.objects.filter(building__name='P9').order_by('name')
        self.assertEqual([r.name for r in racks], ['DM-RACK-01', 'DM-RACK-02'])
        self.assertEqual(racks[0].servers.count(), 20)  # 2U x 20 = 40U

    def test_placed_server_can_be_edited_and_moved(self):
        from .services import place_field_assets
        place_field_assets()
        s = ServerAsset.objects.get(hostname='P1D-DBA')
        r = self.put(f'/api/server/update/{s.id}/', {'start_u': 30})
        self.assertEqual(r.status_code, 200, r.content)

    def test_same_hostname_allowed_in_other_building(self):
        self.add('ControlPC', 1)
        other = Building.objects.create(campus=self.campus, name='S2')
        rack2 = Rack.objects.create(building=other, name='R02')
        r = self.post('/api/server/add/', {'rack_id': rack2.id, 'hostname': 'ControlPC', 'start_u': 1})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.add('controlpc', 5).status_code, 400)  # 같은 건물은 여전히 막음


class FieldCsvRegisterTest(FieldAssetTest):
    NO_ID = ('Hostname,그룹(현장/제품),단지,제품명,상태,PM 날짜,DISK\n'
             'NEW-DB-A,P9 DM,Memory,DM,가동,2026-11-09,정상\n'
             'ControlPC,P9 DM,Memory,DM,가동,,\n'
             'NEW-DB-A,P9 DM,Memory,DM,가동,,\n')     # 파일 안 중복

    def test_register_without_monday_id_and_dedupe(self):
        r = self.upload_field(self.NO_ID).json()
        self.assertEqual((r['created'], len(r['duplicates'])), (2, 1))
        self.assertIn('파일 안 2행', r['duplicates'][0]['reason'])
        a = FieldAsset.objects.get(hostname='NEW-DB-A')
        self.assertTrue(a.locally_modified)
        self.assertIsNone(a.monday_item_id)
        # 같은 파일을 다시 올려도 늘어나지 않음
        r = self.upload_field(self.NO_ID).json()
        self.assertEqual((r['created'], len(r['duplicates'])), (0, 3))
        self.assertEqual(FieldAsset.objects.filter(hostname='NEW-DB-A').count(), 1)

    def test_same_hostname_other_site_is_allowed(self):
        self.upload_field(self.CSV)  # ControlPC @ 1L DM, S5 DAQ
        r = self.upload_field(self.NO_ID).json()
        self.assertEqual(r['created'], 2)  # P9 DM 의 ControlPC 는 다른 현장이라 추가됨

    def test_duplicate_match_ignores_case_and_spaces(self):
        self.upload_field(self.NO_ID)
        r = self.upload_field('Hostname,그룹(현장/제품)\nnew-db-a,P9  DM\n').json()
        self.assertEqual((r['created'], len(r['duplicates'])), (0, 1))

    def test_invalid_values_reported(self):
        r = self.upload_field('Hostname,상태,IPMI 상태,PM 상태,DISK,PM 날짜\n'
                              'A,가동중,,,,\nB,,연결됨,,,\nC,,,끝,,\nD,,,,고장,\nE,,,,,어제\nF,가동,,,,\n').json()
        self.assertEqual((r['created'], len(r['errors'])), (1, 5))

    def test_template_can_be_imported(self):
        tpl = self.c.get('/api/field-assets/import/template/').content.decode('utf-8-sig')
        r = self.upload_field(tpl).json()
        self.assertEqual((r['created'], len(r['errors'])), (1, 0), r)


class FieldRackSyncTest(AutoPlaceTest):
    def test_place_via_api_preview_and_commit(self):
        r = self.post('/api/field-assets/place/', {'mode': 'preview'}).json()
        self.assertEqual(r['placed'], 5)
        self.assertEqual(ServerAsset.objects.count(), 0)
        self.assertEqual(self.c.get('/api/field-assets/').json()['unplaced'], 5)
        self.assertEqual(self.post('/api/field-assets/place/', {}).json()['placed'], 5)
        data = self.c.get('/api/field-assets/').json()
        self.assertEqual(data['unplaced'], 0)
        dba = next(i for i in data['items'] if i['hostname'] == 'P1D-DBA')
        self.assertEqual((dba['rack']['path'], dba['rack']['u']), ('Memory > P1D > DM-RACK-01', 'U2~U3'))

    def test_new_asset_then_button_places_only_new(self):
        self.post('/api/field-assets/place/', {})
        self.post('/api/field-assets/add/', {'hostname': 'P1D-NEW', 'site_group': 'P1D DM', 'complex': 'Memory', 'product': 'DM'})
        r = self.post('/api/field-assets/place/', {}).json()
        self.assertEqual((r['placed'], r['racks_created']), (1, 0))
        self.assertEqual(ServerAsset.objects.get(hostname='P1D-NEW').start_u, 4)  # 기존 장비 다음 U

    def test_edit_field_asset_syncs_rack_server(self):
        self.post('/api/field-assets/place/', {})
        a = FieldAsset.objects.get(hostname='P1D-DBA')
        s = ServerAsset.objects.get(hostname='P1D-DBA')
        self.put(f'/api/server/update/{s.id}/', {'start_u': 20, 'specs': {**s.specs, 'power_w': '800'}})
        r = self.put(f'/api/field-assets/update/{a.id}/', {
            'hostname': 'P1D-DBA-NEW', 'status': 'Parts 교체 필요', 'serial_number': 'SN9',
            'ipmi_ip': '100.100.110.9', 'model_name': 'DL360 Gen11'})
        self.assertEqual(r.status_code, 200, r.content)
        s.refresh_from_db()
        self.assertEqual((s.hostname, s.status, s.model_name), ('P1D-DBA-NEW', 'MAINT', 'DL360 Gen11'))
        self.assertEqual((s.specs['serial_number'], s.specs['mgmt_ip']), ('SN9', '100.100.110.9'))
        # 랙에서만 관리하는 값은 그대로
        self.assertEqual((s.start_u, s.specs['power_w']), (20, '800'))

    def test_renamed_duplicate_keeps_suffix(self):
        self.post('/api/field-assets/place/', {})
        dup = ServerAsset.objects.get(hostname='ControlPC (2)')
        a = FieldAsset.objects.get(id=dup.specs['field_asset_id'])
        self.put(f'/api/field-assets/update/{a.id}/', {'status': '폐기'})
        dup.refresh_from_db()
        self.assertEqual((dup.hostname, dup.status), ('ControlPC (2)', 'IDLE'))

    def test_csv_reimport_syncs_rack_server(self):
        a = FieldAsset.objects.get(hostname='P1D-DBA')
        a.monday_item_id = '999'; a.save()
        self.post('/api/field-assets/place/', {})
        csv = 'monday ID,Hostname,그룹(현장/제품),단지,제품명,상태\n999,P1D-DBA,P1D DM,Memory,DM,사용불가\n'
        f = SimpleUploadedFile('a.csv', csv.encode('utf-8-sig'), content_type='text/csv')
        self.c.post('/api/field-assets/import/', {'file': f}, HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(ServerAsset.objects.get(hostname='P1D-DBA').status, 'MAINT')


class FieldAssetBulkTest(BaseTest):
    def setUp(self):
        super().setUp()
        mk = lambda h, **kw: FieldAsset.objects.create(hostname=h, site_group='P1D DM', status='가동', **kw)
        self.a = mk('BULK-1', health={'cpu': '정상', 'disk': 'Fault'})
        self.b = mk('BULK-2', health={'cpu': 'Fault', 'disk': '정상'})
        self.c3 = mk('BULK-3')

    def test_bulk_pm_record(self):
        r = self.post('/api/field-assets/bulk/', {'ids': [self.a.id, self.b.id], 'pm': {
            'pm_date': '2026-11-17', 'pm_status': '완료', 'worker': '홍길동', 'note': '정기 PM',
            'health': {'cpu': '정상', 'disk': ''}}})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['updated'], 2)
        for asset, disk in ((self.a, 'Fault'), (self.b, '정상')):
            asset.refresh_from_db()
            self.assertEqual(str(asset.pm_date), '2026-11-17')
            self.assertEqual(asset.health['cpu'], '정상')      # 고른 부품은 바뀌고
            self.assertEqual(asset.health['disk'], disk)       # 안 고른 부품은 장비마다 그대로
            self.assertEqual(asset.pm_records.get().worker, '홍길동')
        self.c3.refresh_from_db()
        self.assertIsNone(self.c3.pm_date)

    def test_bulk_fields(self):
        r = self.post('/api/field-assets/bulk/', {'ids': [self.a.id, self.c3.id],
                                                  'fields': {'status': 'Parts 교체 필요', 'warranty_end': '2027-12-31'}})
        self.assertEqual(r.status_code, 200, r.content)
        self.a.refresh_from_db(); self.b.refresh_from_db()
        self.assertEqual((self.a.status, str(self.a.warranty_end), self.a.locally_modified),
                         ('Parts 교체 필요', '2027-12-31', True))
        self.assertEqual(self.b.status, '가동')

    def test_bulk_validation_is_all_or_nothing(self):
        url = '/api/field-assets/bulk/'
        self.assertEqual(self.post(url, {'ids': [], 'fields': {'status': '가동'}}).status_code, 400)
        self.assertEqual(self.post(url, {'ids': [self.a.id]}).status_code, 400)
        self.assertEqual(self.post(url, {'ids': [self.a.id], 'fields': {'hostname': 'X'}}).status_code, 400)
        self.assertEqual(self.post(url, {'ids': [self.a.id], 'fields': {'status': '아무거나'}}).status_code, 400)
        self.assertEqual(self.post(url, {'ids': [self.a.id, 99999], 'fields': {'status': '폐기'}}).status_code, 400)
        self.assertEqual(self.post(url, {'ids': [self.a.id], 'pm': {'pm_date': ''}}).status_code, 400)
        self.assertEqual(self.post(url, {'ids': [self.a.id], 'pm': {'pm_date': '2026-11-17', 'health': {'cpu': '몰라'}}}).status_code, 400)
        self.a.refresh_from_db()
        self.assertEqual(self.a.status, '가동')
        self.assertFalse(PMRecord.objects.exists())
