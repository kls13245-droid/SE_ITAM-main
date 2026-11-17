import json
from datetime import date
from itertools import count
from unittest import mock

from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings

from . import monday, report
from .models import Incident, IncidentLog, ReportBaseline, ReportSync


def tb(text_ops, kind='bulleted list', indent=0):
    return {'deltaFormat': [{'insert': t} for t in text_ops], 'indentation': indent}


class FakeMonday:
    """monday GraphQL을 흉내 낸다. 문서 = 맨 위 단계 블록 목록."""

    def __init__(self, items=None):
        self.ids = count(1000)
        self.blocks = []
        self.fail_on_create = False
        self.calls = []
        self.items = items or [
            {'id': '13554701607', 'name': 'WW47 SE파트 주간보고', 'created_at': '2026-11-16',
             'column_values': [{'id': 'monday_doc', 'value': json.dumps({'files': [{'objectId': 18440079518}]})}]},
            {'id': '13499817464', 'name': 'WW46 SE파트 주간보고', 'created_at': '2026-11-09',
             'column_values': [{'id': 'monday_doc', 'value': json.dumps({'files': [{'objectId': 18439034086}]})}]},
        ]

    def add(self, type_, texts, indent=0, parent=None, attrs=None):
        bid = f'b{next(self.ids)}'
        self.blocks.append({'id': bid, 'type': type_, 'parent_block_id': parent,
                            'content': json.dumps(tb(texts, indent=indent))})
        return bid

    def _reposition(self):
        for n, b in enumerate(self.blocks):
            b['position'] = float(n + 1)

    def _insert_after(self, after, new):
        idx = next(i for i, b in enumerate(self.blocks) if b['id'] == after)
        # 표 같은 블록의 하위 블록은 바로 뒤에 붙어 있으므로 그 뒤에 넣는다
        while idx + 1 < len(self.blocks) and self.blocks[idx + 1]['parent_block_id'] == after:
            idx += 1
        self.blocks[idx + 1:idx + 1] = new

    def query(self, q, v=None):
        v = v or {}
        self.calls.append(q.split('{')[1].split('(')[0].strip())
        self._reposition()
        if 'boards(' in q:
            return {'boards': [{'name': '주간 보고', 'items_page': {'items': self.items}}]}
        if 'docs(object_ids' in q:
            return {'docs': [{'id': f"d{v['o'][0]}", 'object_id': v['o'][0], 'name': 'WW46 문서', 'url': ''}]}
        if 'blocks(' in q and q.lstrip().startswith('query'):
            page = v['p']
            return {'docs': [{'blocks': self.blocks[(page - 1) * 100:page * 100]}]}
        if 'export_markdown_from_doc' in q:
            return {'export_markdown_from_doc': {'success': True, 'markdown':
                    '| 2026년 장애 및 유지보수 | 총 | 진행 | 완료 | 대기 |\n|---|---|---|---|---|\n'
                    '| 장애 | 34 | 2 | 30 | 2 |\n| PM (후속 조치) | 5 | 0 | 5 | 0 |\n| 유지 보수 | 3 | 1 | 2 | 0 |'}}
        if 'add_content_to_doc_from_markdown' in q:
            table = {'id': f'b{next(self.ids)}', 'type': 'table', 'parent_block_id': None, 'content': '{}'}
            cell = {'id': f'b{next(self.ids)}', 'type': 'normal text', 'parent_block_id': table['id'],
                    'content': json.dumps(tb(['장애']))}
            self._insert_after(v['a'], [table, cell])
            return {'add_content_to_doc_from_markdown': {'success': True, 'block_ids': [table['id'], cell['id']],
                                                         'error': None}}
        if 'create_doc_blocks' in q:
            if self.fail_on_create:
                raise monday.MondayError('monday 오류: boom')
            new = []
            for b in v['b']:
                if 'list_block' in b:
                    lb = b['list_block']
                    content = {'deltaFormat': [{'insert': o['insert']['text'], 'attributes': o.get('attributes')}
                                               for o in lb['delta_format']], 'indentation': lb['indentation']}
                    t = 'bulleted list'
                else:
                    content = {'deltaFormat': [{'insert': o['insert']['text']} for o in b['text_block']['delta_format']]}
                    t = 'normal text'
                new.append({'id': f'b{next(self.ids)}', 'type': t, 'parent_block_id': None,
                            'content': json.dumps(content, ensure_ascii=False)})
            self._insert_after(v['a'], new)
            return {'create_doc_blocks': [{'id': b['id']} for b in new]}
        if 'delete_doc_blocks' in q:
            ids = set(v['ids'])
            self.blocks = [b for b in self.blocks if b['id'] not in ids and b['parent_block_id'] not in ids]
            return {'delete_doc_blocks': [{'id': i} for i in v['ids']]}
        raise AssertionError(q)

    def texts(self):
        self._reposition()
        return [monday.block_text(b) for b in self.blocks if not b['parent_block_id']]


def sample_doc(fake):
    fake.add('medium title', ['[금주 업무]'])
    fake.add('normal text', ['기타'])
    fake.add('medium title', ['[2026년 장애 및 유지보수]'])
    fake.add('bulleted list', ['[장애] ', ' 7F 서버 PSU 불량 | ', '진행 중'])
    fake.add('bulleted list', ['(11/12) 벤더 RMA 접수'], indent=1)
    fake.add('bulleted list', ['(11/14) 교체 부품 입고 대기'], indent=2)
    fake.add('normal text', [' '])
    fake.add('bulleted list', ['[유지보수] ', ' 스토리지 펌웨어 업데이트 | ', '완료'])
    fake.add('bulleted list', ['(11/10) 업데이트 완료'], indent=1)
    fake.add('medium title', ['[심의 & H/W SPEC 산정] '])
    fake.add('normal text', ['심의 내용'])


@override_settings(MONDAY_API_TOKEN='test-token')
class IncidentApiTest(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        User.objects.create_user('se', password='pw')
        User.objects.create_user('boss', password='bosspw', is_staff=True)
        self.c = Client(enforce_csrf_checks=True)
        self.token = self.c.get('/api/csrf/').json()['csrf_token']
        r = self.c.post('/api/login/', json.dumps({'username': 'se', 'password': 'pw'}),
                        content_type='application/json', HTTP_X_CSRFTOKEN=self.token)
        self.token = r.json()['csrf_token']
        self.fake = FakeMonday()
        sample_doc(self.fake)
        patcher = mock.patch.object(monday, 'Client', return_value=self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def j(self, method, url, data=None):
        return getattr(self.c, method)(url, json.dumps(data or {}), content_type='application/json',
                                       HTTP_X_CSRFTOKEN=self.token)

    def make(self, **kw):
        data = {'kind': 'FAULT', 'title': '스위치 포트 불량', 'occurred_on': '2026-11-13', 'first_log': '현장 확인'}
        data.update(kw)
        r = self.j('post', '/api/incidents/', data)
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    # --- 입력 ---------------------------------------------------------------
    def test_login_required(self):
        self.assertEqual(Client().get('/api/incidents/').status_code, 401)

    def test_create_and_logs(self):
        inc = self.make()
        self.assertEqual(inc['status'], 'IN_PROGRESS')
        self.assertEqual(len(inc['logs']), 1)
        r = self.j('post', f"/api/incidents/{inc['id']}/logs/", {'text': '포트 교체', 'date': '2026-11-15', 'level': 2})
        logs = r.json()['logs']
        self.assertEqual([l['level'] for l in logs], [1, 2])
        r = self.j('post', f"/api/incidents/{inc['id']}/logs/reorder/", {'ids': [logs[1]['id'], logs[0]['id']]})
        self.assertEqual([l['text'] for l in r.json()['logs']], ['포트 교체', '현장 확인'])
        self.assertEqual(self.j('post', f"/api/incidents/{inc['id']}/logs/", {'text': 'x', 'level': 5}).status_code, 400)

    def test_done_sets_done_on_and_reopen_clears(self):
        inc = self.make()
        r = self.j('put', f"/api/incidents/{inc['id']}/", {'status': '완료'})
        self.assertEqual(r.json()['status'], 'DONE')
        self.assertTrue(r.json()['done_on'])
        r = self.j('put', f"/api/incidents/{inc['id']}/", {'status': 'IN_PROGRESS'})
        self.assertIsNone(r.json()['done_on'])

    def test_validation(self):
        self.assertEqual(self.j('post', '/api/incidents/', {'title': ''}).status_code, 400)
        self.assertEqual(self.j('post', '/api/incidents/', {'title': 'a', 'kind': 'X'}).status_code, 400)
        r = self.j('post', '/api/incidents/', {'title': 'a', 'status': 'DONE', 'occurred_on': '2026-11-10',
                                                'done_on': '2026-11-01'})
        self.assertEqual(r.status_code, 400)

    def test_delete_needs_admin(self):
        inc = self.make()
        self.assertEqual(self.j('delete', f"/api/incidents/{inc['id']}/").status_code, 403)
        r = self.j('delete', f"/api/incidents/{inc['id']}/", {'admin_username': 'boss', 'admin_password': 'bosspw'})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(Incident.objects.exists())

    def test_counts_with_baseline(self):
        self.make()
        self.make(title='b', status='WAIT')
        self.make(title='c', status='DONE', done_on='2026-11-14')
        self.j('put', '/api/incidents/baseline/', {'year': 2026, 'values': {'FAULT': 26}})
        row = next(r for r in report.counts(2026) if r['kind'] == 'FAULT')
        self.assertEqual((row['total'], row['in_progress'], row['done'], row['waiting']), (29, 1, 27, 1))

    # --- 보고 글 -------------------------------------------------------------
    def test_report_selection_and_format(self):
        a = self.make(title='진행 건')
        self.make(title='오래전 완료', status='DONE', occurred_on='2026-10-01', done_on='2026-10-02')
        self.make(title='최근 완료', status='DONE', occurred_on='2026-11-10', done_on='2026-11-14')
        self.make(title='숨김', hide_in_report=True)
        IncidentLog.objects.create(incident_id=a['id'], date=date(2026, 10, 1), text='예전 기록', order=5)
        titles = [i.title for i in report.report_incidents(date(2026, 11, 17))]
        self.assertEqual(sorted(titles), sorted(['최근 완료', '진행 건']))
        lines = report.incident_lines(Incident.objects.get(id=a['id']), date(2026, 11, 17))
        self.assertEqual(report.line_plain(lines[0]), '[장애]  진행 건 | 진행 중')
        self.assertEqual(lines[0]['ops'][2]['attrs']['color'], report.STATUS_COLOR)
        self.assertIn('background', lines[1]['ops'][0]['attrs'])      # 11/13: 최근 7일
        self.assertNotIn('background', lines[2]['ops'][0]['attrs'])   # 10/01: 옛 기록
        self.assertEqual(report.to_block_input(lines[1])['list_block']['indentation'], 1)

    def test_report_text_needs_no_monday(self):
        self.make()
        r = self.j('post', '/api/incidents/report/text/', {'date': '2026-11-17'})
        self.assertEqual(r.json()['week'], 'WW47')
        self.assertIn('[장애]  스위치 포트 불량 | 진행 중', r.json()['text'])
        self.assertEqual(self.fake.calls, [])

    # --- monday 반영 ---------------------------------------------------------
    def test_preview_picks_this_week_and_does_not_write(self):
        before = list(self.fake.texts())
        r = self.j('post', '/api/incidents/report/preview/', {'date': '2026-11-17'})
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual(d['item']['id'], '13554701607')
        self.assertEqual(d['old_block_count'], 6)
        self.assertEqual(self.fake.texts(), before)
        r = self.j('post', '/api/incidents/report/preview/', {'date': '2026-11-17', 'item_id': '13499817464'})
        self.assertEqual(r.json()['doc']['object_id'], '18439034086')

    def test_apply_replaces_only_section(self):
        self.make()
        p = self.j('post', '/api/incidents/report/preview/', {'date': '2026-11-17'}).json()
        r = self.j('post', '/api/incidents/report/apply/', {'date': '2026-11-17', 'item_id': p['item']['id'],
                                                            'fingerprint': p['fingerprint']})
        self.assertEqual(r.status_code, 200, r.content)
        t = self.fake.texts()
        self.assertEqual(t[:3], ['[금주 업무]', '기타', '[2026년 장애 및 유지보수]'])
        self.assertEqual(t[3], '')  # 표 블록
        self.assertEqual(t[4], '[장애]  스위치 포트 불량 | 진행 중')
        self.assertNotIn('(11/12) 벤더 RMA 접수', t)
        self.assertEqual(t[-2:], ['[심의 & H/W SPEC 산정] ', '심의 내용'])
        s = ReportSync.objects.get()
        self.assertTrue(s.ok)
        self.assertEqual(s.deleted_blocks, 6)

    def test_apply_conflict_when_doc_changed(self):
        p = self.j('post', '/api/incidents/report/preview/', {'date': '2026-11-17'}).json()
        self.fake.blocks[4]['content'] = json.dumps(tb(['(11/12) 누가 고침'], indent=1))
        before = list(self.fake.texts())
        r = self.j('post', '/api/incidents/report/apply/', {'date': '2026-11-17', 'item_id': p['item']['id'],
                                                            'fingerprint': p['fingerprint']})
        self.assertEqual(r.status_code, 502)
        self.assertIn('바뀌었습니다', r.json()['error'])
        self.assertEqual(self.fake.texts(), before)
        self.assertFalse(ReportSync.objects.get().ok)

    def test_apply_rolls_back_on_failure(self):
        self.make()
        p = self.j('post', '/api/incidents/report/preview/', {'date': '2026-11-17'}).json()
        before = list(self.fake.texts())
        self.fake.fail_on_create = True
        r = self.j('post', '/api/incidents/report/apply/', {'date': '2026-11-17', 'item_id': p['item']['id'],
                                                            'fingerprint': p['fingerprint']})
        self.assertEqual(r.status_code, 502)
        self.assertIn('도로 지웠습니다', r.json()['error'])
        self.assertEqual(self.fake.texts(), before)

    def test_missing_section_end(self):
        self.fake.blocks = [b for b in self.fake.blocks if '심의' not in monday.block_text(b)]
        r = self.j('post', '/api/incidents/report/preview/', {'date': '2026-11-17'})
        self.assertEqual(r.status_code, 502)
        self.assertIn('섹션 끝', r.json()['error'])

    @override_settings(MONDAY_API_TOKEN='')
    def test_no_token(self):
        mock.patch.stopall()
        r = self.j('post', '/api/incidents/report/preview/', {'date': '2026-11-17'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('MONDAY_API_TOKEN', r.json()['error'])
        self.assertFalse(self.c.get('/api/incidents/').json()['monday']['configured'])

    # --- 가져오기 ------------------------------------------------------------
    def test_import(self):
        p = self.j('post', '/api/incidents/import/preview/', {'date': '2026-11-17'}).json()
        self.assertEqual([i['title'] for i in p['incidents']], ['7F 서버 PSU 불량', '스토리지 펌웨어 업데이트'])
        fault = next(b for b in p['baseline'] if b['kind'] == 'FAULT')
        self.assertEqual(fault['suggested'], 33)
        self.assertFalse(Incident.objects.exists())
        r = self.j('post', '/api/incidents/import/apply/', {'date': '2026-11-17', 'item_id': p['item']['id'],
                                                             'fingerprint': p['fingerprint'], 'baseline': {'FAULT': 33}})
        self.assertEqual(r.json()['added'], 2)
        psu = Incident.objects.get(title='7F 서버 PSU 불량')
        self.assertEqual([(l.date, l.level) for l in psu.logs.all()],
                         [(date(2026, 11, 12), 1), (date(2026, 11, 14), 2)])
        self.assertEqual(Incident.objects.get(title='스토리지 펌웨어 업데이트').status, 'DONE')
        self.assertEqual(ReportBaseline.objects.get(kind='FAULT').done_before, 33)
        r = self.j('post', '/api/incidents/import/apply/', {'date': '2026-11-17', 'item_id': p['item']['id'],
                                                             'fingerprint': p['fingerprint']})
        self.assertEqual((r.json()['added'], r.json()['skipped']), (0, 2))
