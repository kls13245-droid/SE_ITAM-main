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

from . import spec
from .engine import make_ppt
from .models import CpuSpec, MasterList, PartCode, ReviewCase, ReviewOutput, SpecItem

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
        r = self.json('put', f'/api/reviews/{case_id}/', {'status': 'APPROVED'})
        self.assertEqual(r.json()['status'], 'APPROVED')
        self.assertEqual(r.json()['status_label'], '승인')
        # 한글 이름으로 보내도 코드로 저장된다
        r = self.json('put', f'/api/reviews/{case_id}/', {'status': '구매중'})
        self.assertEqual(r.json()['status'], 'PURCHASE')
        r = self.json('put', f'/api/reviews/{case_id}/', {'status': '없는상태'})
        self.assertEqual(r.status_code, 400)
        r = self.json('delete', f'/api/reviews/{case_id}/', {})
        self.assertEqual(r.status_code, 403)
        r = self.json('delete', f'/api/reviews/{case_id}/', {'admin_username': 'boss', 'admin_password': 'bosspw'})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(ReviewCase.objects.exists())
        self.assertFalse(ReviewOutput.objects.exists())


# ---------------------------------------------------------------------------
# 화면에서 입력하는 구매 사양
# ---------------------------------------------------------------------------


def server(name, os_name='Windows 2025', cpu='Xeon Gold 5515', **data):
    d = {'os': os_name, 'cpu': cpu, 'cpu_qty': 2, 'mem': 'DDR5 32', 'mem_qty': 4,
         'disk1_type': 'NVMe', 'disk1': 3.2, 'disk1_unit': 'TB', 'disk1_qty': 2, 'nic': '10G 2Port', 'nic_qty': 2}
    d.update(data)
    return {'block': 'server', 'name': name, 'maker': 'DELL', 'model': 'R660', 'qty': 1, 'data': d}


SAMPLE_ITEMS = [
    server('DB-A', vm_win=1, core=16),
    server('VM-HOST', os_name='vSphere 8.0', vm_win=3, vm_linux=2, core=8, sw={'mssql': 1}),
    {'block': 'storage', 'name': 'ADMS-Unity', 'usage': 'DATA', 'maker': 'DELL', 'model': 'Unity380H', 'qty': 1,
     'data': {'disks': [{'type': 'SSD', 'size': 800, 'unit': 'GB', 'count': 7, 'ratio': 0.5},
                        {'type': 'SATA', 'size': 6, 'unit': 'TB', 'count': 12, 'ratio': 0.8}]}},
    {'block': 'etc', 'kind': 'SAN', 'maker': 'CISCO', 'model': 'MDS9148T', 'qty': 2, 'data': {'spec': 'FC*48'}},
    {'block': 'nw', 'kind': '10G L2 Switch', 'maker': 'DELL', 'model': 'S4128F ON', 'qty': 1, 'data': {'spec': 'SFP*24'}},
    {'block': 'license', 'kind': 'OS', 'maker': 'MicroSoft', 'model': 'Windows Server Volume', 'qty': None,
     'data': {'version': '2025', 'edition': 'Standard', 'basis': 'win_vl'}},
    {'block': 'license', 'kind': 'HyperVisor', 'maker': 'VMWare', 'model': 'vSphere 구독', 'qty': None,
     'data': {'version': '8', 'basis': 'vsphere'}},
    {'block': 'license', 'kind': 'DBMS', 'maker': 'MicroSoft', 'model': 'MSSQL', 'qty': 3, 'data': {'basis': ''}},
]


class SpecCalcTest(TestCase):
    def setUp(self):
        self.master = spec.Master({'Xeon Gold 5515': ('3.2', '8')},
                                  {'code_R660': 'Q430-128953', 'code_UNITY380H': 'Q430-106659', 'code_DL320_Gen12': ''})

    def test_server_and_sw_quantities(self):
        calc = spec.compute(SAMPLE_ITEMS, self.master)
        db, vm = calc['rows'][0], calc['rows'][1]
        self.assertEqual(db['usage'], 'BareMetal')
        self.assertEqual(vm['usage'], 'Hypervisor')
        self.assertEqual((db['clock'], db['cores']), ('3.2', '8'))
        self.assertEqual(db['mem_total'], 128)
        self.assertEqual(db['disks'][0]['total'], 6.4)
        self.assertIsNone(db['guest'])
        self.assertEqual(vm['guest'], 5)
        # 베어메탈 Windows 1대, 코어 16 → 2Core당 1 = 8, 16Core당 1 = 1
        self.assertEqual(db['sw']['win_vl'], 8)
        self.assertEqual(db['sw']['win_dsp'], 1)
        # VM 호스트: Windows VM 3 → 2개 단위로 올림(2) × 16/2 = 16, 16Core당 = 2, Linux VM 2 → 1, 소켓 2
        self.assertEqual(vm['sw']['win_vl'], 16)
        self.assertEqual(vm['sw']['win_dsp'], 2)
        self.assertEqual(vm['sw']['rhel'], 1)
        self.assertEqual(vm['sw']['vsphere'], 2)
        self.assertEqual(calc['sw_total']['win_vl'], 24)
        self.assertEqual(calc['sw_total']['mssql'], 1)
        lic = calc['rows'][5:]
        self.assertEqual([r['qty'] for r in lic], [24, 2, 3])
        self.assertEqual(lic[0]['unit'], '2Core당 1 Copy')
        self.assertEqual(lic[1]['license'], 'subscription')
        self.assertEqual(calc['rows'][3]['name'], 'SAN스위치')
        self.assertEqual(calc['rows'][4]['usage'], '10G Private용 스위치')

    def test_cis_codes_follow_excel_rules(self):
        calc = spec.compute(SAMPLE_ITEMS, self.master)
        self.assertEqual(calc['rows'][0]['codes']['svr'], 'Q430-128953')
        self.assertEqual(calc['rows'][0]['codes']['ram'], '확인필요')        # 이름 없음
        self.assertEqual(calc['rows'][2]['codes']['sto'], 'Q430-106659')     # 대소문자 무시
        empty = spec.compute([dict(server('X'), model='DL320 Gen12')], self.master)
        self.assertEqual(empty['rows'][0]['codes']['svr'], '')               # 이름은 있고 코드가 빈칸

    def test_workbook_is_readable_by_ppt_engine(self):
        wb = spec.build_workbook('DMS25', SAMPLE_ITEMS, self.master)
        buf = io.BytesIO()
        wb.save(buf)
        wb = openpyxl.load_workbook(io.BytesIO(buf.getvalue()), data_only=True)
        sh, cpu = make_ppt.Sheet(wb['구매 사양']), make_ppt.CpuDB(wb)
        self.assertEqual(make_ppt.task_name(sh), 'DMS25')
        hw = [r['cells'] for b in make_ppt.build_HW(sh, cpu)[0] for r in b]
        self.assertEqual(hw[0][3], 'DB-A')
        self.assertEqual(hw[0][4], '3.2GHz 8core * 2, DDR5 32 * 4, NVMe 3.2TB * 2, 10G 2Port * 2')
        self.assertEqual(hw[2][4], '800GB * 7, Usable 2000GB\n6TB * 12, Usable 48TB')
        self.assertEqual([r[2] for r in hw], ['R660', 'R660', 'Unity380H', 'MDS9148T', 'S4128F ON'])
        sw = [r['cells'] for b in make_ppt.build_SW(sh)[0] for r in b]
        self.assertEqual([(r[2], r[-1]) for r in sw], [('Windows Server Volume', '24'), ('vSphere 구독', '2'),
                                                        ('MSSQL', '3')])
        cost = [r['cells'] for b in make_ppt.build_비용(sh, cpu)[0] for r in b]
        self.assertIn(['HW', 'DB-A', 'DELL', 'R660 - Mainboard', 'R660', '1', '', '', 'Q430-128953', '', '', ''], cost)
        self.assertEqual(wb['SW-수량산정']['J7'].value, 24)   # 소계 행 (서버 2줄 아래)

    def test_read_items_round_trip(self):
        wb = spec.build_workbook('DMS25', SAMPLE_ITEMS, self.master)
        buf = io.BytesIO()
        wb.save(buf)
        data = buf.getvalue()
        items, warnings = spec.read_items(openpyxl.load_workbook(io.BytesIO(data), data_only=True),
                                          openpyxl.load_workbook(io.BytesIO(data)))
        self.assertEqual(warnings, [])
        self.assertEqual([it['block'] for it in items], [it['block'] for it in SAMPLE_ITEMS])
        self.assertEqual(items[1]['data']['vm_win'], 3)
        self.assertEqual(items[1]['data']['sw'], {'mssql': 1})
        self.assertEqual(items[0]['data']['disks'], [{'type': 'NVMe', 'size': 3.2, 'unit': 'TB', 'qty': 2}])
        self.assertEqual(items[0]['data']['nics'], [{'model': '10G 2Port', 'qty': 2}])
        self.assertEqual(items[0]['data']['gpus'], [])
        self.assertEqual(items[2]['data']['disks'][0], {'type': 'SSD', 'size': 800, 'unit': 'GB', 'count': 7, 'ratio': 0.5})
        self.assertEqual(items[3]['name'], '')         # 자동 장비명은 비워 둠
        # 만든 엑셀은 계산값만 있으므로 라이선스 수량 기준은 직접 입력으로 읽힌다
        self.assertEqual((items[5]['data']['basis'], items[5]['qty']), ('', 24))

    def test_server_with_many_parts(self):
        """디스크 3개·NIC 2개·GPU 2개 → 칸이 모자란 부품은 아래 행으로, PPT·비용 표·다시 불러오기 모두 반영"""
        big = server('GPU-1', disks=[{'type': 'M.2', 'size': 480, 'unit': 'GB', 'qty': 2},
                                     {'type': 'NVMe', 'size': 3.84, 'unit': 'TB', 'qty': 4},
                                     {'type': 'SATA', 'size': 8, 'unit': 'TB', 'qty': 6}],
                     hbas=[{'model': '32G 2Port', 'qty': 1}],
                     nics=[{'model': '10G 2Port', 'qty': 1}, {'model': '25G 2Port', 'qty': 2}],
                     gpus=[{'model': 'L40S', 'qty': 2}, {'model': 'A16', 'qty': 1}])
        items = [big, SAMPLE_ITEMS[0]]
        master = spec.Master({'Xeon Gold 5515': ('3.2', '8')}, {'code_SATA_8': 'Q-SATA8', 'code_L40S': 'Q-L40S',
                                                                 'code_A16': 'Q-A16'})
        calc = spec.compute(items, master)
        self.assertEqual([d['total'] for d in calc['rows'][0]['disks']], [960, 15.36, 48])
        self.assertEqual([g['code'] for g in calc['rows'][0]['gpus']], ['Q-L40S', 'Q-A16'])
        wb = spec.build_workbook('AI', items, master)
        buf = io.BytesIO()
        wb.save(buf)
        data = buf.getvalue()
        vwb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        ws = vwb['구매 사양']
        self.assertEqual((ws['B4'].value, ws['R4'].value, ws['AA4'].value, ws['AC4'].value), (None, 'SATA', '25G 2Port', 'A16'))
        self.assertEqual(ws['B5'].value, '서버')            # 다음 서버는 아래 행 다음부터
        self.assertEqual(ws['G6'].value, 2)                 # 서버 소계
        sh, cpu = make_ppt.Sheet(ws), make_ppt.CpuDB(vwb)
        hw = [r['cells'] for b in make_ppt.build_HW(sh, cpu)[0] for r in b]
        self.assertEqual(hw[0][4], '3.2GHz 8core * 2, DDR5 32 * 4, M.2 480GB * 2, NVMe 3.84TB * 4, 10G 2Port * 1, '
                                   'L40S * 2, SATA 8TB * 6, 25G 2Port * 2, A16 * 1')
        self.assertEqual([r[3] for r in hw], ['GPU-1', 'DB-A'])
        cost = [r['cells'] for b in make_ppt.build_비용(sh, cpu)[0] for r in b]
        gpu1 = [(r[3], r[4], r[5], r[8]) for r in cost if len(r) > 8 and r[3].endswith(('Disk', 'GPU'))][:5]
        self.assertEqual(gpu1, [('R660 - Disk', 'M.2 480GB', '2', '확인필요'), ('R660 - Disk', 'NVMe 3.84TB', '4', '확인필요'),
                                ('R660 - GPU', 'NVIDIA L40S', '2', 'Q-L40S'), ('R660 - Disk', 'SATA 8TB', '6', 'Q-SATA8'),
                                ('R660 - GPU', 'NVIDIA A16', '1', 'Q-A16')])
        back, warnings = spec.read_items(vwb, openpyxl.load_workbook(io.BytesIO(data)))
        self.assertEqual(warnings, [])
        self.assertEqual(len(back), 2)
        for key in ('disks', 'hbas', 'nics', 'gpus'):
            self.assertEqual(back[0]['data'][key], big['data'][key], key)

    def test_old_fixed_columns_are_converted(self):
        old = {'os': 'Windows 2025', 'disk1_type': 'NVMe', 'disk1': 3.2, 'disk1_unit': 'TB', 'disk1_qty': 2,
               'disk2_type': '', 'disk2': '', 'disk2_unit': 'GB', 'disk2_qty': '', 'hba': '', 'hba_qty': '',
               'nic': '10G 2Port', 'nic_qty': 2, 'gpu': '', 'gpu_qty': ''}
        d = spec.normalize_server(old)
        self.assertEqual(d['disks'], [{'type': 'NVMe', 'size': 3.2, 'unit': 'TB', 'qty': 2}])
        self.assertEqual((d['hbas'], d['nics'], d['gpus']), ([], [{'model': '10G 2Port', 'qty': 2}], []))
        self.assertNotIn('disk1', d)

    def test_read_items_links_license_to_sw_subtotal(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = '구매 사양'
        ws.append(['업무', '유형', '장비명'])
        ws.append([])
        ws.append(['DMS', '서버', 'A'])
        ws.append(['', '서버 소계'])
        ws.append(['업무', '유형', '장비명'])
        ws.append(['License', 'OS', '-', 'OS', 'MicroSoft', 'Windows', "='SW-수량산정'!J6"])
        ws.append(['', 'HA', '-', 'HA', 'MicroSoft', 'MSSQL', "='SW-수량산정'!K19"])
        sw = wb.create_sheet('SW-수량산정')
        for _ in range(4):
            sw.append([])
        sw.append(['', 'DMS', '서버', 'A', 1, None, 1, None, 16])
        sw.append(['', '소계'])
        items, _ = spec.read_items(wb, wb)
        self.assertEqual(items[1]['data']['basis'], 'win_vl')
        self.assertEqual(items[2]['data']['basis'], '')   # 소계가 아닌 칸을 가리키면 직접 입력
        self.assertEqual(items[0]['data']['vm_win'], 1)


class SpecApiTest(ReviewBase):
    def setUp(self):
        super().setUp()
        self.upload('/api/reviews/master/import/', make_workbook())
        self.case_id = self.json('post', '/api/reviews/', {'title': 'DMS25'}).json()['id']
        self.url = f'/api/reviews/{self.case_id}/items/'

    def test_new_case_uses_form_and_excel_upload_switches(self):
        self.assertEqual(ReviewCase.objects.get().input_mode, 'FORM')
        r = self.upload(f'/api/reviews/{self.case_id}/upload/', make_workbook())
        self.assertEqual(r.json()['input_mode'], 'EXCEL')
        r = self.json('put', f'/api/reviews/{self.case_id}/', {'input_mode': 'FORM'})
        self.assertEqual(r.json()['input_mode'], 'FORM')
        r = self.json('put', f'/api/reviews/{self.case_id}/', {'input_mode': 'XX'})
        self.assertEqual(r.status_code, 400)

    def test_save_calc_and_update_keeps_ids(self):
        r = self.json('put', self.url, {'items': SAMPLE_ITEMS})
        self.assertEqual(r.status_code, 200, r.content)
        items = r.json()['items']
        self.assertEqual(len(items), len(SAMPLE_ITEMS))
        self.assertEqual(r.json()['calc']['rows'][0]['clock'], '3.2')
        self.assertEqual(r.json()['case']['item_count'], len(SAMPLE_ITEMS))
        # 첫 줄 수량만 바꾸고 마지막 줄을 지우면, 나머지 줄은 같은 id로 남는다
        items[0]['qty'] = 2
        r = self.json('put', self.url, {'items': items[:-1]})
        after = r.json()['items']
        self.assertEqual([i['id'] for i in after], [i['id'] for i in items[:-1]])
        self.assertEqual(after[0]['qty'], 2)
        self.assertEqual(SpecItem.objects.count(), len(SAMPLE_ITEMS) - 1)
        g = self.c.get(self.url).json()
        self.assertEqual(len(g['sw_products']), 11)
        self.assertIn('SAN', g['kinds']['etc'])

    def test_rejects_bad_rows(self):
        r = self.json('put', self.url, {'items': [{'block': 'xx'}]})
        self.assertEqual(r.status_code, 400)
        r = self.json('put', self.url, {'items': [dict(server('A'), qty='한 대')]})
        self.assertEqual(r.status_code, 400)
        self.assertIn('숫자', r.json()['error'])

    def test_calc_without_saving(self):
        r = self.json('post', f'{self.url}calc/', {'items': SAMPLE_ITEMS})
        self.assertEqual(r.json()['calc']['sw_total']['vsphere'], 2)
        self.assertFalse(SpecItem.objects.exists())

    def test_import_from_uploaded_excel(self):
        src = spec.build_workbook('DMS25', SAMPLE_ITEMS, spec.Master())
        buf = io.BytesIO()
        src.save(buf)
        r = self.upload(f'{self.url}import/', buf.getvalue(), name='spec.xlsx')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.json()['items']), len(SAMPLE_ITEMS))
        self.assertEqual(r.json()['case']['input_mode'], 'FORM')
        # 올려 둔 엑셀이 없으면 파일 없이 불러오기는 안 된다
        r = self.c.post(f'{self.url}import/', HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(r.status_code, 400)

    def test_generate_from_form_and_download_excel(self):
        tpl = SimpleUploadedFile('template.pptx', blank_template())
        self.c.post('/api/reviews/template/', {'file': tpl}, HTTP_X_CSRFTOKEN=self.token)
        r = self.c.post(f'/api/reviews/{self.case_id}/generate/', HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(r.status_code, 400)
        self.assertIn('구매 사양', r.json()['error'])
        self.json('put', self.url, {'items': SAMPLE_ITEMS})
        r = self.c.post(f'/api/reviews/{self.case_id}/generate/', HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(r.status_code, 200, r.content)
        out = r.json()['output']
        self.assertIn('[입력] 화면에서 입력한 구매 사양', out['log'])
        self.assertTrue(out['xlsx_name'].endswith('.xlsx'))
        dl = self.c.get(f'{self.url}excel/')
        self.assertEqual(dl.status_code, 200)
        wb = openpyxl.load_workbook(io.BytesIO(dl.content))
        self.assertEqual(wb.sheetnames, ['구매 사양', 'SW-수량산정', 'CPU 호환 모델'])
        self.assertEqual(wb['구매 사양']['C3'].value, 'DB-A')

    def test_add_list_value_from_form(self):
        url = '/api/reviews/master/lists/add/'
        r = self.json('post', url, {'name': '제조사_서버', 'value': 'LENOVO'})
        self.assertEqual(r.json()['values'], ['DELL', 'HPE', 'LENOVO'])
        # 같은 값은 두 번 들어가지 않는다
        r = self.json('post', url, {'name': '제조사_서버', 'value': 'LENOVO'})
        self.assertEqual(r.json()['values'], ['DELL', 'HPE', 'LENOVO'])
        self.assertEqual(MasterList.objects.get(name='제조사_서버').history.count(), 2)
        # 없는 목록은 새로 만든다
        r = self.json('post', url, {'name': '서버모델_LENOVO', 'value': 'SR650 V3'})
        self.assertEqual(r.json()['group'], '서버모델')
        # 새 CPU는 클럭·코어가 있어야 한다
        r = self.json('post', url, {'name': 'List_SR650_V3', 'value': 'Xeon Gold 6526Y'})
        self.assertEqual(r.status_code, 400)
        r = self.json('post', url, {'name': 'List_SR650_V3', 'value': 'Xeon Gold 6526Y', 'clock': '2.8', 'cores': '16'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(CpuSpec.objects.get(name='Xeon Gold 6526Y').cores, '16')
        # 이미 있는 CPU는 클럭·코어 없이 다른 모델 목록에 넣을 수 있다
        r = self.json('post', url, {'name': 'List_R660', 'value': 'Xeon Gold 5515'})
        self.assertEqual(r.status_code, 200)
        r = self.json('post', url, {'name': '', 'value': 'x'})
        self.assertEqual(r.status_code, 400)
