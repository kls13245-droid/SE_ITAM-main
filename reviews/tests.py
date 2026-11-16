import io
import json
import shutil
import tempfile

import openpyxl
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from openpyxl.workbook.defined_name import DefinedName
from pptx import Presentation

from .models import CpuSpec, MasterList, PartCode, ReviewCase, ReviewOutput

XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.12'


def make_workbook(cis_r660='Q430-128953', with_spec=True):
    """심의 매크로 엑셀을 흉내 낸 작은 워크북 (DB 시트 + 이름 관리자 + CPU 호환 모델 + 구매 사양)"""
    wb = openpyxl.Workbook()
    db = wb.active
    db.title = 'DB'
    db['A1'], db['B1'], db['G1'], db['H1'] = 'HW구분', 'HW항목', '품목', 'CIS-CODE'
    db['B2'], db['B3'] = 'DELL', 'HPE'
    db['G2'], db['H2'] = 'R660', cis_r660
    db['G3'], db['H3'] = 'R760', 'Q430-124313'
    wb.defined_names['제조사_서버'] = DefinedName('제조사_서버', attr_text='DB!$B$2:$B$3')
    wb.defined_names['code_R660'] = DefinedName('code_R660', attr_text='DB!$H$2')
    wb.defined_names['code_R760'] = DefinedName('code_R760', attr_text='DB!$H$3')
    cpu = wb.create_sheet('CPU 호환 모델')
    cpu.append(['CPU', 'GHz', 'Core'])
    cpu.append(['Xeon Gold 5515', 3.2, 8])
    if with_spec:
        spec = wb.create_sheet('구매 사양')
        spec.append(['업무', '유형', '장비명'])
        spec.append(['', '', ''])
        spec.append(['DMS 증설', '서버', 'R660'])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def blank_template():
    buf = io.BytesIO()
    Presentation().save(buf)
    return buf.getvalue()


class ReviewBase(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        User.objects.create_user('admin', password='pw')
        User.objects.create_user('boss', password='bosspw', is_staff=True)
        self.c = Client(enforce_csrf_checks=True)
        self.token = self.c.get('/api/csrf/').json()['csrf_token']
        r = self.c.post('/api/login/', json.dumps({'username': 'admin', 'password': 'pw'}),
                        content_type='application/json', HTTP_X_CSRFTOKEN=self.token)
        self.token = r.json()['csrf_token']

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def upload(self, url, data, name='심의.xlsm', **extra):
        f = SimpleUploadedFile(name, data, content_type=XLSM)
        return self.c.post(url, {'file': f, **extra}, HTTP_X_CSRFTOKEN=self.token)

    def json(self, method, url, data):
        return getattr(self.c, method)(url, json.dumps(data), content_type='application/json',
                                       HTTP_X_CSRFTOKEN=self.token)


class MasterImportTest(ReviewBase):
    def test_preview_does_not_change_db(self):
        r = self.upload('/api/reviews/master/import/', make_workbook(cis_r660='Q430-'), mode='preview')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['codes']['added'], 2)
        self.assertEqual(r.json()['missing_cis'], ['R660'])
        self.assertFalse(PartCode.objects.exists())

    def test_import_and_reimport(self):
        r = self.upload('/api/reviews/master/import/', make_workbook())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PartCode.objects.get(name='R660').cis_code, 'Q430-128953')
        self.assertEqual(MasterList.objects.get(name='제조사_서버').values, ['DELL', 'HPE'])
        self.assertEqual(MasterList.objects.get(name='제조사_서버').group, '제조사')
        self.assertEqual(CpuSpec.objects.get(name='Xeon Gold 5515').cores, '8')
        # 다시 가져오면 바뀐 코드만 변경으로 잡힘
        r = self.upload('/api/reviews/master/import/', make_workbook(cis_r660='Q430-999999'))
        self.assertEqual(r.json()['codes'], {'added': 0, 'changed': 1, 'removed': 0, 'total': 2})
        self.assertEqual(PartCode.objects.get(name='R660').history.count(), 2)
        # 선택 목록·CPU 사양도 변경 이력이 남는다
        self.assertEqual(MasterList.objects.get(name='제조사_서버').history.count(), 1)
        self.assertEqual(CpuSpec.objects.get(name='Xeon Gold 5515').history.count(), 1)
        cpu = CpuSpec.objects.get(name='Xeon Gold 5515')
        cpu.cores = '16'
        cpu.save()
        self.assertEqual(cpu.history.first().cores, '16')
        self.assertEqual(cpu.history.last().cores, '8')

    def test_master_list_api(self):
        self.upload('/api/reviews/master/import/', make_workbook())
        data = self.c.get('/api/reviews/master/').json()
        self.assertEqual(len(data['codes']), 2)
        code = PartCode.objects.get(name='R760')
        r = self.json('put', f'/api/reviews/master/codes/{code.id}/', {'cis_code': 'Q430-000001'})
        self.assertEqual(r.json()['cis_code'], 'Q430-000001')

    def test_rejects_non_excel(self):
        r = self.upload('/api/reviews/master/import/', b'abc', name='a.txt')
        self.assertEqual(r.status_code, 400)
        r = self.upload('/api/reviews/master/import/', b'not a zip', name='a.xlsx')
        self.assertEqual(r.status_code, 400)
        self.assertIn('열 수 없습니다', r.json()['error'])


class ReviewCaseTest(ReviewBase):
    def test_login_required(self):
        self.assertEqual(Client().get('/api/reviews/').status_code, 401)

    def test_create_from_excel_uses_task_name(self):
        r = self.upload('/api/reviews/', make_workbook(), year='2026', line='P3')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['title'], 'DMS 증설')
        self.assertTrue(r.json()['has_source'])

    def test_create_requires_title_or_file(self):
        r = self.json('post', '/api/reviews/', {'line': 'P3'})
        self.assertEqual(r.status_code, 400)

    def test_excel_without_spec_sheet_is_rejected(self):
        r = self.upload('/api/reviews/', make_workbook(with_spec=False))
        self.assertEqual(r.status_code, 400)
        self.assertIn('구매 사양', r.json()['error'])
        self.assertFalse(ReviewCase.objects.exists())

    def test_generate_needs_template_then_makes_files(self):
        case_id = self.upload('/api/reviews/', make_workbook()).json()['id']
        r = self.c.post(f'/api/reviews/{case_id}/generate/', HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(r.status_code, 400)
        self.assertIn('템플릿', r.json()['error'])

        tpl = SimpleUploadedFile('template.pptx', blank_template())
        r = self.c.post('/api/reviews/template/', {'file': tpl}, HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(r.json()['name'], 'template.pptx')

        r = self.c.post(f'/api/reviews/{case_id}/generate/', HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(r.status_code, 200, r.content)
        out = r.json()['output']
        self.assertTrue(out['pptx_name'].endswith('.pptx'))
        self.assertTrue(out['xlsx_name'].endswith('.xlsx'))
        self.assertNotIn('/tmp', out['log'])
        dl = self.c.get(f"/api/reviews/outputs/{out['id']}/pptx/")
        self.assertEqual(dl.status_code, 200)
        self.assertTrue(b''.join(dl.streaming_content).startswith(b'PK'))

    def test_update_and_delete_needs_admin(self):
        case_id = self.json('post', '/api/reviews/', {'title': 'A'}).json()['id']
        r = self.json('put', f'/api/reviews/{case_id}/', {'status': '심의중'})
        self.assertEqual(r.json()['status'], '심의중')
        r = self.json('put', f'/api/reviews/{case_id}/', {'status': '없는상태'})
        self.assertEqual(r.status_code, 400)
        r = self.json('delete', f'/api/reviews/{case_id}/', {})
        self.assertEqual(r.status_code, 403)
        r = self.json('delete', f'/api/reviews/{case_id}/', {'admin_username': 'boss', 'admin_password': 'bosspw'})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(ReviewCase.objects.exists())
        self.assertFalse(ReviewOutput.objects.exists())
