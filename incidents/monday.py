"""monday.com 주간보고 문서 읽기·쓰기.

흐름 (주간보고 반영):
 1. 'SE파트 | 주간 보고' 보드에서 이번 주 아이템(이름에 WW47 등)을 찾는다. 없으면 가장 최근 아이템.
 2. 아이템의 monday Doc 칸에 연결된 문서를 연다. (문서 이름이 아니라 연결된 문서를 기준으로 한다)
 3. 문서에서 '장애 및 유지보수' 제목을 찾고, 그 다음 '[...]' 제목 앞까지를 이 섹션으로 본다.
 4. 미리보기 때 섹션 내용의 지문(fingerprint)을 같이 보여 주고, 반영할 때 다시 읽어 같은지 확인한다.
    (그 사이 누가 문서를 고쳤으면 반영하지 않는다)
 5. 새 내용(건수 표 + 건별 줄)을 제목 바로 아래에 먼저 넣고, 다 들어간 뒤에 옛 내용을 지운다.
    넣다가 실패하면 넣은 것만 도로 지워서 문서는 그대로 둔다.
"""
import hashlib
import json
import re
import urllib.error
import urllib.request

from django.conf import settings
from django.db import transaction

from . import report
from .models import Incident, IncidentLog, ReportBaseline, ReportSync

TITLE_TYPES = ('large title', 'medium title', 'small title')
SECTION_KEYWORD = '장애 및 유지보수'
CREATE_CHUNK = 25    # create_doc_blocks 한 번에 최대 25개
DELETE_CHUNK = 100   # delete_doc_blocks 한 번에 최대 100개


class MondayError(Exception):
    pass


def board_id():
    return str(getattr(settings, 'MONDAY_REPORT_BOARD_ID', '') or '5333463389')


def doc_column_id():
    return getattr(settings, 'MONDAY_DOC_COLUMN_ID', '') or 'monday_doc'


def configured():
    return bool(getattr(settings, 'MONDAY_API_TOKEN', ''))


# ---------------------------------------------------------------------------
# API 호출
# ---------------------------------------------------------------------------
class Client:
    def __init__(self, token=None, url=None, version=None, timeout=30):
        self.token = token if token is not None else getattr(settings, 'MONDAY_API_TOKEN', '')
        self.url = url or getattr(settings, 'MONDAY_API_URL', '') or 'https://api.monday.com/v2'
        self.version = version if version is not None else getattr(settings, 'MONDAY_API_VERSION', '')
        self.timeout = timeout
        if not self.token:
            raise MondayError('monday API 토큰이 설정되지 않았습니다. 서버 환경변수 MONDAY_API_TOKEN을 넣고 다시 시작해 주세요.')

    def query(self, query, variables=None):
        payload = json.dumps({'query': query, 'variables': variables or {}}).encode('utf-8')
        headers = {'Authorization': self.token, 'Content-Type': 'application/json'}
        if self.version:
            headers['API-Version'] = self.version
        req = urllib.request.Request(self.url, data=payload, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                data = json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise MondayError('monday가 토큰을 받지 않았습니다. MONDAY_API_TOKEN이 맞는지, 보드·문서에 권한이 있는 계정의 토큰인지 확인해 주세요.')
            if e.code == 429:
                raise MondayError('monday 요청 한도를 넘었습니다. 1분쯤 뒤에 다시 시도해 주세요.')
            raise MondayError(f'monday 서버 오류 ({e.code})')
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise MondayError('monday.com에 연결하지 못했습니다. ITAM 서버에서 api.monday.com으로 나가는 HTTPS 접속이 '
                              f'열려 있는지 확인해 주세요. ({e})')
        errors = data.get('errors') or ([{'message': data['error_message']}] if data.get('error_message') else [])
        if errors:
            raise MondayError('monday 오류: ' + '; '.join(str(e.get('message', e)) for e in errors))
        return data.get('data') or {}


# ---------------------------------------------------------------------------
# 보드·문서 읽기
# ---------------------------------------------------------------------------
def list_items(client, limit=10):
    q = '''query($b:[ID!], $c:[String!], $n:Int!) { boards(ids:$b) { name items_page(limit:$n,
            query_params:{order_by:[{column_id:"__creation_log__", direction:desc}]}) {
            items { id name created_at column_values(ids:$c) { id value } } } } }'''
    data = client.query(q, {'b': [board_id()], 'c': [doc_column_id()], 'n': limit})
    boards = data.get('boards') or []
    if not boards:
        raise MondayError(f'주간보고 보드({board_id()})를 찾지 못했습니다. 토큰 계정에 보드 권한이 있는지 확인해 주세요.')
    out = []
    for it in (boards[0].get('items_page') or {}).get('items') or []:
        out.append({'id': str(it['id']), 'name': it.get('name') or '', 'created_at': it.get('created_at'),
                    'doc_object_id': doc_object_id(it)})
    return out


def doc_object_id(item):
    for cv in item.get('column_values') or []:
        try:
            files = json.loads(cv.get('value') or '{}').get('files') or []
        except (TypeError, ValueError):
            continue
        for f in files:
            if f.get('objectId'):
                return str(f['objectId'])
            m = re.search(r'/docs/(\d+)', f.get('linkToFile') or '')
            if m:
                return m.group(1)
    return None


def pick_item(items, report_date, item_id=None):
    if item_id:
        for it in items:
            if it['id'] == str(item_id):
                return it
        raise MondayError('고른 주간보고 아이템을 최근 목록에서 찾지 못했습니다. 새로고침 후 다시 골라 주세요.')
    week = report_date.isocalendar()[1]
    pattern = re.compile(rf'WW\s*0?{week}(?!\d)', re.I)
    for it in items:
        if pattern.search(it['name']):
            return it
    if not items:
        raise MondayError('주간보고 보드에 아이템이 없습니다.')
    return items[0]


def get_doc(client, object_id):
    data = client.query('query($o:[ID!]) { docs(object_ids:$o) { id object_id name url } }', {'o': [object_id]})
    docs = data.get('docs') or []
    if not docs:
        raise MondayError('아이템에 연결된 문서를 열지 못했습니다. 토큰 계정에 문서 권한이 있는지 확인해 주세요.')
    return docs[0]


def get_blocks(client, doc_id):
    blocks, page = [], 1
    q = 'query($d:[ID!], $p:Int!) { docs(ids:$d) { blocks(limit:100, page:$p) { id type parent_block_id position content } } }'
    while True:
        docs = client.query(q, {'d': [doc_id], 'p': page}).get('docs') or []
        part = (docs[0].get('blocks') if docs else None) or []
        blocks.extend(part)
        if len(part) < 100 or page >= 50:
            break
        page += 1
    return blocks


def export_markdown(client, doc_id):
    data = client.query('query($d:ID!) { export_markdown_from_doc(docId:$d) { success markdown error } }', {'d': doc_id})
    res = data.get('export_markdown_from_doc') or {}
    return res.get('markdown') or ''


def _content(block):
    c = block.get('content')
    if isinstance(c, str):
        try:
            c = json.loads(c)
        except ValueError:
            c = {}
    return c if isinstance(c, dict) else {}


def block_text(block):
    parts = []
    for op in _content(block).get('deltaFormat') or []:
        ins = op.get('insert')
        if isinstance(ins, str):
            parts.append(ins)
    return ''.join(parts)


def simple(block):
    return {'id': block['id'], 'type': block.get('type'), 'text': block_text(block),
            'indent': _content(block).get('indentation') or 0, 'position': block.get('position') or 0}


def locate_section(blocks):
    """(제목 블록, 섹션 안 블록들). 문서 맨 위 단계 블록만 본다 (표 칸 같은 하위 블록 제외)."""
    top = sorted((b for b in blocks if not b.get('parent_block_id')), key=lambda b: b.get('position') or 0)
    start = None
    for i, b in enumerate(top):
        if b.get('type') in TITLE_TYPES and SECTION_KEYWORD in block_text(b):
            start = i
            break
    if start is None:
        raise MondayError(f"문서에서 '{SECTION_KEYWORD}' 제목을 찾지 못했습니다. 섹션 제목을 확인해 주세요.")
    end = None
    for j in range(start + 1, len(top)):
        b = top[j]
        if b.get('type') in ('large title', 'medium title') and block_text(b).strip().startswith('['):
            end = j
            break
    if end is None:
        raise MondayError(f"'{SECTION_KEYWORD}' 섹션 다음의 '[...]' 제목을 찾지 못해 섹션 끝을 알 수 없습니다. "
                          '섹션 아래에 다음 제목이 있는지 확인해 주세요.')
    return top[start], top[start + 1:end]


def fingerprint(inner):
    h = hashlib.sha1()
    for b in inner:
        h.update(str(b['id']).encode())
        c = b.get('content')
        h.update((c if isinstance(c, str) else json.dumps(c, sort_keys=True, ensure_ascii=False)).encode('utf-8'))
    return h.hexdigest()[:16]


def _open(client, report_date, item_id=None):
    items = list_items(client)
    item = pick_item(items, report_date, item_id)
    if not item.get('doc_object_id'):
        raise MondayError(f"'{item['name']}' 아이템의 monday Doc 칸이 비어 있습니다. 문서를 먼저 연결해 주세요.")
    doc = get_doc(client, item['doc_object_id'])
    blocks = get_blocks(client, doc['id'])
    heading, inner = locate_section(blocks)
    return items, item, doc, heading, inner


def _target_dict(items, item, doc, heading, inner):
    return {
        'items': [{'id': i['id'], 'name': i['name'], 'created_at': i['created_at']} for i in items],
        'item': {'id': item['id'], 'name': item['name']},
        'doc': {'id': str(doc['id']), 'object_id': str(doc.get('object_id') or ''), 'name': doc.get('name') or '',
                'url': doc.get('url') or ''},
        'heading': block_text(heading).strip(),
        'old_block_count': len(inner),
        'fingerprint': fingerprint(inner),
    }


# ---------------------------------------------------------------------------
# 주간보고 반영
# ---------------------------------------------------------------------------
def preview(report_date, item_id=None, client=None):
    client = client or Client()
    items, item, doc, heading, inner = _open(client, report_date, item_id)
    out = _target_dict(items, item, doc, heading, inner)
    lines = report.section_lines(report_date)
    out.update({
        'week': report.week_label(report_date),
        'counts': report.counts(report_date.year),
        'incident_count': len(report.report_incidents(report_date)),
        'new_block_count': len(lines) + 1,
        'preview': report.preview_text(report_date),
        'old_preview': '\n'.join(('    ' * (s['indent'] or 0) + '- ' if s['type'] == 'bulleted list' else '')
                                 + s['text'].rstrip() for s in map(simple, inner)).strip(),
    })
    return out


def _top_level_new(client, doc_id, new_ids):
    """방금 넣은 블록 중 맨 위 단계 블록을 문서 순서대로 (표 칸 같은 하위 블록 제외)"""
    ids = set(new_ids)
    found = [b for b in get_blocks(client, doc_id) if b['id'] in ids and not b.get('parent_block_id')]
    return sorted(found, key=lambda b: b.get('position') or 0)


def _delete(client, ids):
    deleted = 0
    for i in range(0, len(ids), DELETE_CHUNK):
        part = ids[i:i + DELETE_CHUNK]
        client.query('mutation($ids:[ID!]!) { delete_doc_blocks(block_ids:$ids) { id } }', {'ids': part})
        deleted += len(part)
    return deleted


def apply(report_date, item_id, expected_fingerprint, user=None, client=None):
    client = client or Client()
    sync = ReportSync(created_by=user if getattr(user, 'is_authenticated', False) else None)
    created = []
    try:
        items, item, doc, heading, inner = _open(client, report_date, item_id)
        sync.item_id, sync.item_name = item['id'], item['name']
        sync.doc_id, sync.doc_name = str(doc['id']), doc.get('name') or ''
        if expected_fingerprint and fingerprint(inner) != expected_fingerprint:
            raise MondayError('미리보기 뒤에 문서의 이 섹션이 바뀌었습니다. 미리보기를 다시 눌러 확인한 뒤 반영해 주세요.')
        old_ids = [b['id'] for b in inner]

        # 1) 건수 표 (마크다운 → 표 블록)
        res = client.query('mutation($d:ID!, $m:String!, $a:String) { add_content_to_doc_from_markdown(docId:$d, markdown:$m, afterBlockId:$a) { success block_ids error } }',
                           {'d': str(doc['id']), 'm': report.table_markdown(report_date.year), 'a': heading['id']})
        res = res.get('add_content_to_doc_from_markdown') or {}
        if not res.get('success'):
            raise MondayError(f"건수 표를 넣지 못했습니다: {res.get('error') or '알 수 없는 오류'}")
        created.extend(res.get('block_ids') or [])
        tops = _top_level_new(client, str(doc['id']), created)
        after = tops[-1]['id'] if tops else heading['id']

        # 2) 건별 줄 (서식 포함), 25개씩
        blocks = [report.to_block_input(line) for line in report.section_lines(report_date)]
        for i in range(0, len(blocks), CREATE_CHUNK):
            data = client.query('mutation($d:ID!, $a:String, $b:[CreateBlockInput!]!) { create_doc_blocks(docId:$d, afterBlockId:$a, blocksInput:$b) { id } }',
                                {'d': str(doc['id']), 'a': after, 'b': blocks[i:i + CREATE_CHUNK]})
            got = [b['id'] for b in (data.get('create_doc_blocks') or []) if b and b.get('id')]
            if not got:
                raise MondayError('건별 줄을 넣지 못했습니다 (monday가 빈 결과를 돌려줌).')
            created.extend(got)
            after = got[-1]
        sync.created_blocks = len(created)
    except Exception as err:  # noqa: BLE001 - 무슨 오류든 넣던 것을 되돌린다
        e = err if isinstance(err, MondayError) else MondayError(f'예상하지 못한 오류: {err}')
        if created:  # 넣다가 실패: 넣은 것만 도로 지워 문서를 그대로 둔다
            try:
                _delete(client, created)
                e = MondayError(f'{e} (넣던 내용은 도로 지웠습니다. 문서는 그대로입니다.)')
            except MondayError:
                e = MondayError(f'{e} (넣던 내용 일부가 문서에 남아 있을 수 있습니다. 섹션을 확인해 주세요.)')
        sync.ok, sync.message = False, str(e)
        sync.save()
        raise e

    # 3) 옛 내용 지우기
    try:
        sync.deleted_blocks = _delete(client, old_ids)
        sync.ok = True
        sync.message = f"{report.week_label(report_date)} 반영 완료: 건 {len(report.report_incidents(report_date))}개"
    except MondayError as e:
        sync.ok = False
        sync.message = f'새 내용은 넣었지만 옛 내용을 지우다 멈췄습니다: {e} 문서에서 옛 줄을 직접 지워 주세요.'
    sync.save()
    return sync


# ---------------------------------------------------------------------------
# 기존 문서에서 가져오기 (처음 한 번)
# ---------------------------------------------------------------------------
def import_preview(report_date, item_id=None, client=None):
    client = client or Client()
    items, item, doc, heading, inner = _open(client, report_date, item_id)
    out = _target_dict(items, item, doc, heading, inner)
    parsed = report.parse_section([simple(b) for b in inner], report_date)
    existing = {(i.kind, i.title.strip()) for i in Incident.objects.all()}
    for p in parsed:
        p['duplicate'] = (p['kind'], p['title']) in existing
    table = report.parse_table(export_markdown(client, str(doc['id'])))
    year = report_date.year
    current = {b.kind: b.done_before for b in ReportBaseline.objects.filter(year=year)}
    baseline = []
    for kind in report.KIND_ORDER:
        n_new = sum(1 for p in parsed if p['kind'] == kind)
        row = table.get(kind)
        suggest = max(0, row[0] - n_new) if row else 0
        baseline.append({'kind': kind, 'label': report.KIND_LABEL[kind], 'doc_row': list(row) if row else None,
                         'items_in_doc': n_new, 'suggested': suggest, 'current': current.get(kind)})
    out.update({'year': year, 'incidents': [_json_item(p) for p in parsed], 'baseline': baseline})
    return out


def _json_item(p):
    return {**p, 'occurred_on': p['occurred_on'].isoformat(), 'done_on': p['done_on'].isoformat() if p['done_on'] else None,
            'logs': [{**l, 'date': l['date'].isoformat() if l['date'] else None} for l in p['logs']]}


@transaction.atomic
def import_apply(report_date, item_id, fingerprint_expected, baseline, user=None, client=None):
    """미리보기와 같은 내용을 다시 읽어 저장한다. 이미 있는 건(같은 유형·제목)은 건너뛴다."""
    client = client or Client()
    _, item, doc, heading, inner = _open(client, report_date, item_id)
    if fingerprint_expected and fingerprint(inner) != fingerprint_expected:
        raise MondayError('미리보기 뒤에 문서가 바뀌었습니다. 미리보기를 다시 눌러 주세요.')
    parsed = report.parse_section([simple(b) for b in inner], report_date)
    existing = {(i.kind, i.title.strip()) for i in Incident.objects.all()}
    by = user if getattr(user, 'is_authenticated', False) else None
    added = skipped = 0
    for p in parsed:
        if (p['kind'], p['title']) in existing:
            skipped += 1
            continue
        inc = Incident.objects.create(kind=p['kind'], title=p['title'], status=p['status'], occurred_on=p['occurred_on'],
                                      done_on=p['done_on'], monday_title=p['source'][:300], created_by=by)
        IncidentLog.objects.bulk_create([
            IncidentLog(incident=inc, date=l['date'], text=l['text'], level=l['level'], order=n, created_by=by)
            for n, l in enumerate(p['logs'], start=1)])
        existing.add((p['kind'], p['title']))
        added += 1
    for kind, value in (baseline or {}).items():
        if kind in report.KIND_ORDER and value is not None and str(value).strip() != '':
            n = int(value)
            if n < 0:
                raise MondayError('이전 완료 건수는 0 이상이어야 합니다.')
            ReportBaseline.objects.update_or_create(year=report_date.year, kind=kind, defaults={'done_before': n})
    return {'added': added, 'skipped': skipped, 'item': item['name'], 'doc': doc.get('name') or ''}
