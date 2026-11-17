"""기준정보 1차 정리 (2026-11-17 검증 결과 중 사용자가 정한 수정안)

python manage.py apply_master_fixes [--dry-run]
여러 번 실행해도 결과가 같다. 바뀐 내용은 변경 이력(simple_history)에도 남는다.
지우거나 이름을 바꾼 값은 변경 이력에 남아 있어, 매크로 엑셀에서 없는 값을 더할 때도 다시 들어오지 않는다.
"""
from django.db import transaction

from . import spec
from .models import MasterList, PartCode, SpecItem

# 1. CPU 호환 목록만 있고 서버 모델 목록에 없던 모델: (목록, 넣을 모델, 이 값 뒤에 넣음)
ADD_MODELS = [
    ('서버모델_DELL', 'R770', 'R7715'), ('서버모델_DELL', 'R670', 'R770'),
    ('서버모델_DELL', 'R6725', 'R670'), ('서버모델_DELL', 'R6715', 'R6725'),
    ('서버모델_HPE', 'DL385 Gen12', 'DL320 Gen12'), ('서버모델_HPE', 'DL365 Gen12', 'DL385 Gen12'),
    ('서버모델_HPE', 'DL345 Gen12', 'DL365 Gen12'), ('서버모델_HPE', 'DL325 Gen12', 'DL345 Gen12'),
    ('서버모델_HPE', 'DL20 Gen12', 'DL325 Gen12'),
    ('서버모델_HPE', 'DL385 Gen11', 'DL20 Gen11'), ('서버모델_HPE', 'DL365 Gen11', 'DL385 Gen11'),
    ('서버모델_HPE', 'DL345 Gen11', 'DL365 Gen11'), ('서버모델_HPE', 'DL325 Gen11', 'DL345 Gen11'),
]
# 3. CPU 이름 통일 (CPU 사양·품목 이름에 맞춤)
CPU_RENAME = {f'E-{n}': f'Xeon E-{n}' for n in (2224, 2236, 2314, 2336, 2414, 2436, 2456, 2468, 2478, 2488)}
# 4. 모델 목록·워런티 품목이 없는 서버 제조사 삭제
REMOVE_VALUES = [('제조사_서버', 'LENOVO')]
# 5~7. 오타·띄어쓰기
RENAME_VALUES = {'FAS7200': 'FAS2720', 'DSC 7050SX3': 'DCS 7050SX3', 'Ubuntu16.04': 'Ubuntu 16.04'}
RENAME_CODES = {'DSC 7050SX3': 'DCS 7050SX3'}
# 8·9. 새 목록·값
ADD_VALUES = [('SW_캐노니컬', 'Ubuntu', None), ('MEMORY', 'DDR4 16', None), ('MEMORY', 'DDR4 32', None)]



def _rename_all(values, mapping):
    return [mapping.get(v, v) for v in values]


def apply(dry_run=False):
    """수정안을 반영하고 바뀐 내용 목록을 돌려준다. dry_run이면 저장하지 않는다"""
    changes = []
    with transaction.atomic():
        lists = {m.name: m for m in MasterList.objects.all()}
        before = {n: list(m.values) for n, m in lists.items()}

        def lst(name):
            if name not in lists:
                lists[name] = MasterList(name=name, group=_group(name), values=[], source='기준정보 정리 2026-11-17')
                before[name] = None
            return lists[name]

        for name, model, after in ADD_MODELS:
            m = lst(name)
            if model not in m.values:
                i = m.values.index(after) + 1 if after in m.values else len(m.values)
                m.values = m.values[:i] + [model] + m.values[i:]
        for name, m in lists.items():
            if name.startswith('List_'):
                m.values = _dedupe(_rename_all(m.values, CPU_RENAME))
            m.values = _dedupe(_rename_all(m.values, RENAME_VALUES))
        for name, value in REMOVE_VALUES:
            if name in lists:
                lists[name].values = [v for v in lists[name].values if v != value]
        for name, value, _ in ADD_VALUES:
            m = lst(name)
            if value not in m.values:
                m.values = m.values + [value]
        for name, m in lists.items():
            if before[name] != m.values:
                changes.append({'area': '선택 목록', 'target': name, 'before': before[name], 'after': m.values})
                if not dry_run:
                    m.save()

        for old, new in RENAME_CODES.items():
            p = PartCode.objects.filter(name=old).first()
            if p and not PartCode.objects.filter(name=new).exists():
                key = spec._code_key(new, ' .-(')
                changes.append({'area': '품목 CIS', 'target': old, 'before': [p.name, p.key], 'after': [new, key]})
                if not dry_run:
                    p.name, p.key = new, key
                    p.save()

        # 저장된 구매 사양에서 바뀐 값을 쓰던 칸도 같이 바꾼다
        for it in SpecItem.objects.all():
            data = dict(it.data or {})
            fields = {}
            if it.block == 'server':
                if data.get('cpu') in CPU_RENAME:
                    data['cpu'] = CPU_RENAME[data['cpu']]
                if data.get('os') in RENAME_VALUES:
                    data['os'] = RENAME_VALUES[data['os']]
            if it.model in RENAME_VALUES:
                fields['model'] = RENAME_VALUES[it.model]
            if data != (it.data or {}) or fields:
                changes.append({'area': '구매 사양', 'target': f'{it.case.title} / {it.name or it.model}',
                                'before': [it.model, (it.data or {}).get('cpu'), (it.data or {}).get('os')],
                                'after': [fields.get('model', it.model), data.get('cpu'), data.get('os')]})
                if not dry_run:
                    it.data = data
                    for k, v in fields.items():
                        setattr(it, k, v)
                    it.save()
        if dry_run:
            transaction.set_rollback(True)
    return changes


def _dedupe(values):
    out = []
    for v in values:
        if v not in out:
            out.append(v)
    return out


def _group(name):
    from .services import list_group
    return list_group(name)
