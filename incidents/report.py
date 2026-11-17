"""주간보고 '[YYYY년 장애 및 유지보수]' 섹션을 만들고, 기존 문서에서 건을 읽어 온다.

monday 문서와 주고받는 부분(monday.py)과 나눠 두어서, 여기는 DB와 글자만 다룬다.
"""
import re
from datetime import date, timedelta

from .models import Incident, ReportBaseline

KIND_ORDER = ['FAULT', 'PM', 'MAINT']
KIND_LABEL = dict(Incident.KIND_CHOICES)
STATUS_LABEL = dict(Incident.STATUS_CHOICES)

# monday 문서가 쓰는 색 (지금 주간보고에 쓰인 값 그대로)
TAG_BACKGROUND = 'var(--color-sunset-selected)'     # [장애] 꼬리표 배경
STATUS_COLOR = 'var(--color-done-green)'            # 상태 글자색
RECENT_BACKGROUND = 'var(--color-done-green-selected)'  # 최근 7일 진행 기록 배경

RECENT_DAYS = 7


def week_label(day):
    """ISO 주차. 2026-11-17 → 'WW47'"""
    return f"WW{day.isocalendar()[1]:02d}"


# ---------------------------------------------------------------------------
# 건수 표
# ---------------------------------------------------------------------------
def counts(year):
    """유형별 [총 건수, 진행 중, 완료, 보류 및 대기]. ITAM 이전 완료 건수를 총 건수·완료에 더한다."""
    base = {b.kind: b.done_before for b in ReportBaseline.objects.filter(year=year)}
    rows = []
    for kind in KIND_ORDER:
        qs = Incident.objects.filter(kind=kind, occurred_on__year=year)
        in_progress = qs.filter(status='IN_PROGRESS').count()
        done = qs.filter(status='DONE').count()
        waiting = qs.filter(status__in=['WAIT', 'HOLD']).count()
        before = base.get(kind, 0)
        rows.append({
            'kind': kind, 'label': KIND_LABEL[kind], 'baseline': before,
            'total': before + in_progress + done + waiting,
            'in_progress': in_progress, 'done': before + done, 'waiting': waiting,
        })
    return rows


def table_markdown(year):
    head = f"| {year}년 장애 및 유지보수 | {year}년 총 건수 | 진행 중 | 완료 | 보류 및 대기 |"
    lines = [head, '| --- | --- | --- | --- | --- |']
    for r in counts(year):
        lines.append(f"| {r['label']} | {r['total']} | {r['in_progress']} | {r['done']} | {r['waiting']} |")
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# 보고서에 들어갈 건과 줄
# ---------------------------------------------------------------------------
def report_incidents(report_date):
    """주간보고에 넣을 건: 끝나지 않은 건 + 최근 7일 안에 끝난 건 ('주간보고에서 빼기'는 제외)"""
    since = report_date - timedelta(days=RECENT_DAYS)
    items = []
    for inc in Incident.objects.filter(hide_in_report=False, occurred_on__lte=report_date).prefetch_related('logs'):
        if inc.status == 'DONE' and not (inc.done_on and inc.done_on >= since):
            continue
        items.append(inc)
    items.sort(key=lambda i: (KIND_ORDER.index(i.kind), i.occurred_on, i.id))
    return items


def _op(text, **attrs):
    attrs = {k: v for k, v in attrs.items() if v}
    return {'text': text, 'attrs': attrs}


def log_text(log):
    return f"({log.date.month:02d}/{log.date.day:02d}) {log.text}" if log.date else log.text


def incident_lines(inc, report_date):
    """한 건을 주간보고 줄 목록으로. 각 줄은 {'type': 'list'|'blank', 'indent', 'ops'}"""
    tag = Incident.KIND_TAG.get(inc.kind, inc.kind)
    lines = [{'type': 'list', 'indent': 0, 'ops': [
        _op(f"[{tag}] ", bold=True, background=TAG_BACKGROUND),
        _op(f" {inc.title} | ", bold=True),
        _op(STATUS_LABEL.get(inc.status, inc.status), bold=True, color=STATUS_COLOR),
    ]}]
    since = report_date - timedelta(days=RECENT_DAYS)
    recent = False
    for log in inc.logs.all():
        if log.date:  # 날짜 없는 줄은 바로 위 날짜 줄을 따라간다
            recent = log.date >= since
        lines.append({'type': 'list', 'indent': max(1, min(log.level, 3)),
                      'ops': [_op(log_text(log), background=RECENT_BACKGROUND if recent else None)]})
    return lines


BLANK = {'type': 'blank', 'indent': 0, 'ops': [_op(' ')]}


def section_lines(report_date):
    """표 아래에 들어갈 줄 전체 (건 사이에는 빈 줄)"""
    out = []
    for inc in report_incidents(report_date):
        out.extend(incident_lines(inc, report_date))
        out.append(dict(BLANK))
    out.append(dict(BLANK))
    return out


def line_plain(line):
    return ''.join(o['text'] for o in line['ops']).rstrip()


def preview_text(report_date):
    """화면 미리보기용 글 (표 + 줄)"""
    text = [table_markdown(report_date.year), '']
    for line in section_lines(report_date):
        if line['type'] == 'blank':
            text.append('')
        else:
            text.append('    ' * line['indent'] + '- ' + line_plain(line))
    return '\n'.join(text).rstrip() + '\n'


def to_block_input(line):
    """monday create_doc_blocks의 CreateBlockInput 하나"""
    delta = []
    for o in line['ops']:
        op = {'insert': {'text': o['text']}}
        if o['attrs']:
            op['attributes'] = o['attrs']
        delta.append(op)
    if line['type'] == 'blank':
        return {'text_block': {'text_block_type': 'NORMAL_TEXT', 'delta_format': delta}}
    return {'list_block': {'list_block_type': 'BULLETED_LIST', 'indentation': line['indent'], 'delta_format': delta}}


# ---------------------------------------------------------------------------
# 기존 monday 문서에서 건 읽어 오기 (처음 한 번)
# ---------------------------------------------------------------------------
TITLE_RE = re.compile(r'^\s*\[(장애|PM|유지\s*보수)\]\s*(.+?)\s*\|\s*(진행\s*중|대기|보류|완료)\s*$')
DATE_RE = re.compile(r'^\s*\((\d{1,2})/(\d{1,2})\)\s*(.*)$')
KIND_BY_TAG = {'장애': 'FAULT', 'PM': 'PM', '유지보수': 'MAINT'}
STATUS_BY_LABEL = {'진행중': 'IN_PROGRESS', '대기': 'WAIT', '보류': 'HOLD', '완료': 'DONE'}
TABLE_ROW_RE = re.compile(r'^\|\s*(장애|PM[^|]*|유지\s*보수)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|')


def _guess_date(month, day, report_date):
    """'(10/8)'처럼 연도가 없는 날짜. 보고일보다 한 달 넘게 뒤면 작년으로 본다."""
    try:
        d = date(report_date.year, month, day)
    except ValueError:
        return None
    if d > report_date + timedelta(days=31):
        try:
            d = date(report_date.year - 1, month, day)
        except ValueError:
            return None
    return d


def parse_section(blocks, report_date):
    """섹션 블록 목록 → 건 목록. blocks: [{'type', 'text', 'indent'}] (문서 순서)

    '[장애] 제목 | 상태' 줄이 건의 시작이고, 그 아래 들여쓴 줄이 진행 기록이다.
    """
    items, cur = [], None
    for b in blocks:
        text = (b.get('text') or '').strip()
        if b.get('type') != 'bulleted list' or not text:
            continue
        m = TITLE_RE.match(text) if (b.get('indent') or 0) == 0 else None
        if m:
            tag = re.sub(r'\s+', '', m.group(1))
            cur = {'kind': KIND_BY_TAG[tag], 'title': m.group(2).strip(),
                   'status': STATUS_BY_LABEL[re.sub(r'\s+', '', m.group(3))], 'logs': [], 'source': text}
            items.append(cur)
            continue
        if cur is None:
            continue
        dm = DATE_RE.match(text)
        d = _guess_date(int(dm.group(1)), int(dm.group(2)), report_date) if dm else None
        body = dm.group(3).strip() if dm and d else text
        cur['logs'].append({'date': d, 'text': body, 'level': max(1, min(b.get('indent') or 1, 3))})
    for it in items:
        dates = [l['date'] for l in it['logs'] if l['date']]
        it['occurred_on'] = min(dates) if dates else report_date
        it['done_on'] = (max(dates) if dates else report_date) if it['status'] == 'DONE' else None
    return items


def parse_table(markdown):
    """문서 마크다운에서 장애·PM·유지보수 건수 표를 찾는다. {'FAULT': (총, 진행, 완료, 대기)}"""
    found = {}
    for line in (markdown or '').splitlines():
        m = TABLE_ROW_RE.match(line.strip())
        if not m:
            continue
        label = re.sub(r'\s+', '', m.group(1))
        kind = 'FAULT' if label == '장애' else 'PM' if label.startswith('PM') else 'MAINT'
        found.setdefault(kind, tuple(int(m.group(i)) for i in range(2, 6)))
    return found
