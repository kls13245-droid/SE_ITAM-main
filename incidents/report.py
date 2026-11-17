"""장애·유지보수 건수 표와 주간보고에 붙여 넣을 '[YYYY년 장애 및 유지보수]' 섹션 글을 만든다."""
from datetime import timedelta

from .models import Incident, ReportBaseline

KIND_ORDER = ['FAULT', 'PM', 'MAINT']
KIND_LABEL = dict(Incident.KIND_CHOICES)
STATUS_LABEL = dict(Incident.STATUS_CHOICES)

# 서식 정보 (지금 주간보고 문서에 쓰인 색). 글로 복사할 때는 쓰이지 않는다
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
def itam_counts(year, kind):
    """ITAM에 입력된 건만으로 센 (진행 중, 완료, 보류 및 대기)"""
    qs = Incident.objects.filter(kind=kind, occurred_on__year=year)
    return (qs.filter(status='IN_PROGRESS').count(), qs.filter(status='DONE').count(),
            qs.filter(status__in=['WAIT', 'HOLD']).count())


def counts(year):
    """유형별 [총 건수, 진행 중, 완료, 보류 및 대기] = ITAM 건으로 센 값 + 보정값. 총 건수는 세 칸의 합."""
    base = {b.kind: b for b in ReportBaseline.objects.filter(year=year)}
    rows = []
    for kind in KIND_ORDER:
        i, d, w = itam_counts(year, kind)
        b = base.get(kind)
        adj = (b.adj_in_progress, b.done_before, b.adj_waiting) if b else (0, 0, 0)
        in_progress, done, waiting = (max(0, i + adj[0]), max(0, d + adj[1]), max(0, w + adj[2]))
        rows.append({
            'kind': kind, 'label': KIND_LABEL[kind], 'baseline': adj[1],
            'total': in_progress + done + waiting, 'in_progress': in_progress, 'done': done, 'waiting': waiting,
            'itam': {'in_progress': i, 'done': d, 'waiting': w},
            'adjust': {'in_progress': adj[0], 'done': adj[1], 'waiting': adj[2]},
        })
    return rows


def set_counts(year, kind, in_progress, done, waiting):
    """표에 보일 숫자를 직접 정한다. ITAM 건으로 센 값과의 차이를 보정값으로 저장."""
    i, d, w = itam_counts(year, kind)
    ReportBaseline.objects.update_or_create(year=year, kind=kind, defaults={
        'adj_in_progress': in_progress - i, 'done_before': done - d, 'adj_waiting': waiting - w})


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

