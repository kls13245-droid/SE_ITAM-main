"""기준정보를 화면에서 직접 고치는 기능 (CIS 코드 관리 탭, Part 등록 탭)

기준정보 원본은 ITAMS DB다. 여기서 고친 내용은 모두 변경 이력(simple_history)에 남고,
history_rows()로 '누가 언제 무엇을 바꿨는지'를 화면에 보여 준다.
"""
import re

from django.db import transaction

from assets.services import ValidationError
from .models import CpuSpec, MasterList, PartCode
from .spec import _code_key

MAX_LEN = 150


def _text(v, label, required=False, max_len=MAX_LEN):
    s = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    if required and not s:
        raise ValidationError(f'{label}을(를) 입력해 주세요.')
    if len(s) > max_len:
        raise ValidationError(f'{label}이(가) 너무 깁니다. ({max_len}자 이하)')
    return s


# ---------------------------------------------------------------------------
# Part 등록: 선택 목록을 부품 종류별로 묶는다
# ---------------------------------------------------------------------------
PART_CATEGORIES = [
    ('server', '서버'), ('storage', '스토리지'), ('cpu', 'CPU'), ('memdisk', '메모리·디스크'),
    ('card', 'HBA·NIC·GPU'), ('nw', '네트워크·랙·KVM'), ('sw', 'OS·SW'), ('etc', '기타'),
]


def part_category(name):
    """선택 목록 이름(엑셀 이름 관리자 규칙) → Part 등록 탭의 부품 종류"""
    n = name or ''
    low = n.lower()
    if n == '제조사_서버' or n.startswith('서버모델_'):
        return 'server'
    if n == '제조사_스토리지' or n.startswith('스토리지모델_'):
        return 'storage'
    if n.startswith('List_') or low == 'cpu':
        return 'cpu'
    if n in ('MEMORY', 'DiskType') or 'disk' in low or 'mem' in low:
        return 'memdisk'
    if n in ('HBA', 'NIC', 'GPU') or n.startswith('GPU_'):
        return 'card'
    if n.startswith(('모델_', 'Spec_', '제조사_')) or 'rack' in low or 'kvm' in low:
        return 'nw'
    if n == 'OS' or n.startswith('SW_') or n.endswith(('_ver', '_Edition')):
        return 'sw'
    return 'etc'


def clean_values(values):
    if not isinstance(values, list):
        raise ValidationError('값 목록 형식이 올바르지 않습니다.')
    out, seen = [], set()
    for v in values:
        s = _text(v, '값')
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


def create_list(name, values=()):
    from .services import list_group
    name = _text(name, '목록 이름', required=True)
    if ' ' in name:
        raise ValidationError("목록 이름에는 띄어쓰기 대신 '_'를 써 주세요. (예: 서버모델_DELL)")
    if MasterList.objects.filter(name__iexact=name).exists():
        raise ValidationError(f"'{name}' 목록이 이미 있습니다.")
    return MasterList.objects.create(name=name, group=list_group(name), values=clean_values(list(values)),
                                     source='화면에서 추가')


def update_list(m, values):
    values = clean_values(values)
    if values != m.values:
        m.values = values
        m.save()
    return m


# ---------------------------------------------------------------------------
# CPU 사양
# ---------------------------------------------------------------------------
def _number(v, label, integer=False):
    s = _text(v, label, required=True, max_len=30)
    try:
        n = float(s)
    except ValueError:
        raise ValidationError(f'{label}은(는) 숫자로 입력해 주세요.')
    if n <= 0 or (integer and n != int(n)):
        raise ValidationError(f'{label}이(가) 올바르지 않습니다.')
    return str(int(n)) if integer else s


def save_cpu(data, cpu=None):
    """CPU 사양을 만들거나 고친다. data['lists']가 있으면 그 CPU 호환 목록(List_*)에만 들어가게 맞춘다.
    이름을 바꾸면 CPU 호환 목록에 적힌 이름도 같이 바꾼다."""
    name = _text(data.get('name'), 'CPU 이름', required=True)
    clock = _number(data.get('clock'), '클럭(GHz)')
    cores = _number(data.get('cores'), '코어 수', integer=True)
    dup = CpuSpec.objects.filter(name__iexact=name)
    if cpu:
        dup = dup.exclude(id=cpu.id)
    if dup.exists():
        raise ValidationError(f"'{name}' CPU가 이미 있습니다.")
    wanted = None
    if 'lists' in data:
        wanted = {str(x) for x in (data.get('lists') or [])}
        bad = [x for x in wanted if not x.startswith('List_')]
        if bad:
            raise ValidationError(f"CPU 호환 목록이 아닙니다: {', '.join(bad)}")
    with transaction.atomic():
        old = cpu.name if cpu else None
        cpu = cpu or CpuSpec()
        if (cpu.name, cpu.clock, cpu.cores) != (name, clock, cores):
            cpu.name, cpu.clock, cpu.cores = name, clock, cores
            cpu.save()
        for lst in MasterList.objects.filter(name__startswith='List_'):
            vals = list(lst.values)
            if old and old != name:
                vals = [name if v == old else v for v in vals]
            if wanted is not None:
                has = name in vals
                if lst.name in wanted and not has:
                    vals.append(name)
                elif lst.name not in wanted and has:
                    vals = [v for v in vals if v != name]
            if vals != lst.values:
                lst.values = vals
                lst.save()
    return cpu


def delete_cpu(cpu):
    with transaction.atomic():
        for lst in MasterList.objects.filter(name__startswith='List_'):
            if cpu.name in lst.values:
                lst.values = [v for v in lst.values if v != cpu.name]
                lst.save()
        cpu.delete()


def cpu_dict(c, lists=None):
    if lists is None:
        lists = MasterList.objects.filter(name__startswith='List_')
    return {'id': c.id, 'name': c.name, 'clock': c.clock, 'cores': c.cores,
            'lists': [m.name for m in lists if c.name in m.values]}


# ---------------------------------------------------------------------------
# 품목 CIS 코드 (CIS 코드는 고객사가 주는 값. 화면에서 입력만 받고 추측해서 채우지 않는다)
# ---------------------------------------------------------------------------
CIS_PATTERN = re.compile(r'^Q4\w{2}-\w+$')


def code_dict(p):
    return {'id': p.id, 'name': p.name, 'key': p.key, 'cis_code': p.cis_code,
            'updated_at': p.updated_at.isoformat() if p.updated_at else None}


def save_code(data, p=None):
    """품목 CIS 코드를 만들거나 고친다. 이름 관리자 이름(key)을 비우면 엑셀 규칙대로 code_품목 으로 만든다."""
    partial = p is not None
    name = _text(data.get('name', p.name if p else ''), '품목', required=True)
    key = _text(data.get('key', p.key if p else ''), '이름 관리자 이름')
    if not key:
        key = _code_key(name, ' .-(')
    if not key.startswith('code_'):
        raise ValidationError("이름 관리자 이름은 'code_'로 시작해야 합니다. (예: code_R660)")
    if ' ' in key:
        raise ValidationError("이름 관리자 이름에는 띄어쓰기를 쓸 수 없습니다.")
    cis = _text(data.get('cis_code', p.cis_code if p else ''), 'CIS 코드', max_len=50).replace(' ', '')
    others = PartCode.objects.exclude(id=p.id) if partial else PartCode.objects.all()
    if others.filter(name__iexact=name).exists():
        raise ValidationError(f"'{name}' 품목이 이미 있습니다.")
    if others.filter(key__iexact=key).exists():
        raise ValidationError(f"이름 관리자 이름 '{key}'을(를) 다른 품목이 쓰고 있습니다.")
    p = p or PartCode()
    if (p.name, p.key, p.cis_code) != (name, key, cis):
        p.name, p.key, p.cis_code = name, key, cis
        p.save()
    return p


# ---------------------------------------------------------------------------
# 변경 이력 (서버 장비 '상세 이력 조회'와 같은 모양으로 돌려준다)
# ---------------------------------------------------------------------------
HISTORY_MODELS = {'codes': PartCode, 'lists': MasterList, 'cpus': CpuSpec}
_SKIP = {'id', 'updated_at'}


def _fmt(v):
    if v is None:
        return ''
    if isinstance(v, list):
        return ', '.join(str(x) for x in v)
    return str(v)


def _label(model, field):
    try:
        return re.sub(r'\s*\(.*\)$', '', str(model._meta.get_field(field).verbose_name))
    except Exception:
        return field


def _changes(model, h, prev):
    fields = [f.attname for f in model._meta.concrete_fields if f.attname not in _SKIP]
    if h.history_type == '+' or prev is None:
        return [{'field': _label(model, f), 'old': '', 'new': _fmt(getattr(h, f))} for f in fields if _fmt(getattr(h, f))]
    if h.history_type == '-':
        return [{'field': _label(model, f), 'old': _fmt(getattr(h, f)), 'new': ''} for f in fields if _fmt(getattr(h, f))]
    out = []
    for f in fields:
        old, new = getattr(prev, f), getattr(h, f)
        if old == new:
            continue
        if isinstance(old, list) or isinstance(new, list):
            old, new = old or [], new or []
            added = [x for x in new if x not in old]
            removed = [x for x in old if x not in new]
            if added:
                out.append({'field': '값 추가', 'old': '', 'new': _fmt(added)})
            if removed:
                out.append({'field': '값 삭제', 'old': _fmt(removed), 'new': ''})
            if not added and not removed:
                out.append({'field': '순서 변경', 'old': _fmt(old), 'new': _fmt(new)})
            continue
        out.append({'field': _label(model, f), 'old': _fmt(old), 'new': _fmt(new)})
    return out


def history_rows(kind, obj_id=None, limit=200):
    model = HISTORY_MODELS.get(kind)
    if model is None:
        raise ValidationError('이력 종류는 codes, lists, cpus 중 하나여야 합니다.')
    qs = model.history.select_related('history_user').order_by('-history_date', '-history_id')
    if obj_id:
        qs = qs.filter(id=obj_id)
    rows = []
    for h in qs[:limit]:
        changes = _changes(model, h, h.prev_record)
        if h.history_type == '~' and not changes:
            continue
        rows.append({
            'history_id': h.history_id, 'object_id': h.id, 'name': h.name,
            'date': h.history_date.isoformat(), 'user': h.history_user.username if h.history_user else 'System',
            'type': {'+': 'Created', '~': 'Updated', '-': 'Deleted'}[h.history_type],
            'reason': h.history_change_reason or '', 'changes': changes,
        })
    return rows
