import json

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from .models import Building, Campus, FieldAsset, Rack, ServerAsset


class BaseTest(TestCase):
    def setUp(self):
        User.objects.create_user('admin', password='pw')
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

    def delete(self, url):
        return self.c.delete(url, HTTP_X_CSRFTOKEN=self.token)

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


class DeleteGuardTest(BaseTest):
    def test_rack_with_servers_not_deleted(self):
        self.add('a', 1)
        r = self.delete(f'/api/rack/delete/{self.rack.id}/')
        self.assertEqual(r.status_code, 409)
        self.assertTrue(Rack.objects.filter(id=self.rack.id).exists())

    def test_building_and_campus_with_servers_not_deleted(self):
        self.add('a', 1)
        self.assertEqual(self.delete(f'/api/building/delete/{self.building.id}/').status_code, 409)
        self.assertEqual(self.delete(f'/api/campus/delete/{self.campus.id}/').status_code, 409)

    def test_empty_rack_deleted(self):
        self.assertEqual(self.delete(f'/api/rack/delete/{self.rack.id}/').status_code, 200)


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
