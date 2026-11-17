import json
from datetime import date

from django.contrib.auth.models import User
from django.test import Client, TestCase

from . import report
from .models import Incident, IncidentLog


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
        self.assertEqual(lines[1]['indent'], 1)

    def test_report_text(self):
        self.make()
        r = self.j('post', '/api/incidents/report/text/', {'date': '2026-11-17'})
        self.assertEqual(r.json()['week'], 'WW47')
        self.assertIn('[장애]  스위치 포트 불량 | 진행 중', r.json()['text'])

    def test_baseline_api(self):
        r = self.j('put', '/api/incidents/baseline/', {'year': 2026, 'values': {'PM': 4}})
        row = next(x for x in r.json()['counts'] if x['kind'] == 'PM')
        self.assertEqual((row['total'], row['done']), (4, 4))
        self.assertEqual(self.j('put', '/api/incidents/baseline/', {'year': 2026, 'values': {'PM': -1}}).status_code, 400)
