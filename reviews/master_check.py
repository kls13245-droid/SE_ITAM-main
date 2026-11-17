"""기준정보(선택 목록·CPU 사양·품목 CIS 코드) 검증과 정리

- check()      : 문제 목록을 만든다. level = fix(바로 정리 가능) / ask(사람이 정해야 함) / info(참고)
- apply_safe() : 판단이 필요 없는 정리만 한다 (앞뒤·겹친 공백, 빈 값, 같은 목록 안의 중복 값)
                 바꾼 내용은 변경 이력(simple_history)과 돌려주는 목록에 남는다.

매크로 엑셀을 다시 가져오면 엑셀 기준으로 덮어쓰므로, 같은 수정을 원본 엑셀에도 해야 한다.
"""
import re
from collections import defaultdict

from django.db import transaction

from . import spec
from .models import CpuSpec, MasterList, PartCode

CIS_OK = re.compile(r'^Q4\w{2}-\d{6}$')
# 서버 모델명 앞부분 → 제조사 (CPU 호환 목록만 있고 서버 모델 목록에 없는 모델의 제조사 추정용)
MAKER_BY_PREFIX = (('DL', 'HPE'), ('R', 'DELL'))


def _clean(v):
    return re.sub(r'\s+', ' ', str(v or '')).strip()


def _norm(v):
    """표기 차이 비교용: 대소문자·공백·'-'·'_' 무시, Plus = +"""
    s = str(v or '').upper().replace('PLUS', '+')
    return re.sub(r'[\s\-_]', '', s)


def _us(model):
    """모델명 → 이름 관리자 이름 조각 (화면 SpecEditor의 us()와 같은 규칙)"""
    return _clean(model).replace(' ', '_').replace('+', 'Plus')


def _issue(out, level, area, target, problem, suggestion=''):
    out.append({'level': level, 'area': area, 'target': target, 'problem': problem, 'suggestion': suggestion})


def check():
    out = []
    lists = {m.name: m for m in MasterList.objects.all()}
    lower = {n.lower(): m for n, m in lists.items()}
    cpus = list(CpuSpec.objects.all())
    codes = list(PartCode.objects.all())
    master = spec.Master({c.name: (c.clock, c.cores) for c in cpus}, {p.key: p.cis_code for p in codes if p.key})

    def get(name):
        m = lower.get(name.lower())
        return m.values if m else None

    # 1. 공백·빈 값·중복 (선택 목록)
    for m in lists.values():
        seen = {}
        for v in m.values:
            s = str(v)
            if not _clean(s):
                _issue(out, 'fix', '선택 목록', m.name, '빈 값이 들어 있음', '빈 값 삭제')
                continue
            if s != _clean(s):
                _issue(out, 'fix', '선택 목록', m.name, f"'{s}' 앞뒤 또는 중간에 공백이 더 있음", f"'{_clean(s)}'(으)로 정리")
            key = _clean(s).lower()
            if key in seen:
                _issue(out, 'fix', '선택 목록', m.name, f"'{_clean(s)}'이(가) 두 번 들어 있음", '뒤의 것 삭제')
            else:
                seen[key] = s
        by_norm = defaultdict(set)
        for v in m.values:
            if _clean(v):
                by_norm[_norm(v)].add(_clean(v))
        for vs in by_norm.values():
            if len({v.lower() for v in vs}) > 1:
                _issue(out, 'ask', '선택 목록', m.name, f"표기만 다른 값: {', '.join(sorted(vs))}", '하나로 통일')
        if not [v for v in m.values if _clean(v)]:
            _issue(out, 'info', '선택 목록', m.name, '값이 하나도 없음')

    # 2. 공백 (CPU 사양, 품목)
    for c in cpus:
        if c.name != _clean(c.name):
            _issue(out, 'fix', 'CPU 사양', c.name, '이름에 공백이 더 있음', f"'{_clean(c.name)}'(으)로 정리")
        if not c.clock or not c.cores:
            _issue(out, 'ask', 'CPU 사양', c.name, '클럭 또는 코어 수가 비어 있음', '값 입력')
    for p in codes:
        if p.name != _clean(p.name):
            _issue(out, 'fix', '품목 CIS', p.name, '품목 이름에 공백이 더 있음', f"'{_clean(p.name)}'(으)로 정리")
        if p.cis_code != p.cis_code.strip():
            _issue(out, 'fix', '품목 CIS', p.name, 'CIS 코드 앞뒤에 공백이 있음', f"'{p.cis_code.strip()}'(으)로 정리")

    # 3. 서버 모델 ↔ CPU 호환 목록
    models = {}  # 모델 → 제조사
    for name, m in lists.items():
        if name.startswith('서버모델_'):
            for v in m.values:
                if _clean(v):
                    models[_clean(v)] = name[len('서버모델_'):]
    for model, maker in models.items():
        if get(f'List_{_us(model)}') is None:
            _issue(out, 'ask', '서버 모델', model, f'{maker} 서버 모델인데 CPU 호환 목록(List_{_us(model)})이 없음',
                   'CPU 호환 목록 추가 (없으면 화면에서 CPU를 고를 수 없음)')
    model_norms = {_norm(m) for m in models}
    for name in lists:
        if name.startswith('List_'):
            model = name[5:].replace('_', ' ').replace('Plus', '+')
            if _norm(model) not in model_norms:
                maker = next((mk for pre, mk in MAKER_BY_PREFIX if model.upper().startswith(pre)), '?')
                _issue(out, 'ask', '서버 모델', model, f'CPU 호환 목록은 있는데 서버 모델 목록에 없음 (화면에서 고를 수 없음)',
                       f'서버모델_{maker}에 추가')
    for maker in get('제조사_서버') or []:
        if get(f'서버모델_{_clean(maker)}') is None:
            _issue(out, 'ask', '서버 모델', _clean(maker), f'서버 제조사에는 있는데 서버모델_{_clean(maker)} 목록이 없음',
                   '모델 목록 추가 또는 제조사에서 삭제')
    for maker in get('제조사_스토리지') or []:
        if get(f'스토리지모델_{_clean(maker)}') is None:
            _issue(out, 'ask', '스토리지 모델', _clean(maker), f'스토리지 제조사에는 있는데 스토리지모델_{_clean(maker)} 목록이 없음')

    # 4. CPU 호환 목록의 CPU ↔ CPU 사양
    cpu_names = {c.name.upper(): c.name for c in cpus}
    reported = set()
    for name, m in lists.items():
        if not name.startswith('List_'):
            continue
        for v in m.values:
            v = _clean(v)
            if not v or v.upper() in cpu_names or v in reported:
                continue
            reported.add(v)
            spec_hit = master.cpu(v)
            similar = [n for n in cpu_names.values() if spec.Master.model_no(n) == spec.Master.model_no(v)]
            if spec_hit and similar:
                _issue(out, 'ask', 'CPU 이름', v, f"CPU 사양·품목에는 '{similar[0]}'(으)로 되어 있어 표기가 다름 "
                       '(클럭·코어는 번호로 찾지만 CIS 코드는 못 찾음)', f"목록 값을 '{similar[0]}'(으)로 통일")
            else:
                _issue(out, 'ask', 'CPU 이름', v, 'CPU 사양(클럭·코어)이 없음', 'CPU 사양 추가')

    # 5. CIS 코드: 비었거나 형식이 불완전, 서로 다른 품목이 같은 코드
    by_code = defaultdict(list)
    for p in codes:
        code = p.cis_code.strip()
        if not code:
            _issue(out, 'ask', '품목 CIS', p.name, 'CIS 코드가 비어 있음 (PPT 비용 표에 빈칸)', '코드 입력')
        elif not CIS_OK.match(code):
            _issue(out, 'ask', '품목 CIS', p.name, f"CIS 코드 '{code}' 형식이 불완전", '코드 확인')
        else:
            by_code[code].append(p.name)
    for code, names in by_code.items():
        if len(names) > 1 and not all(n.upper().endswith('WAR') for n in names):
            _issue(out, 'info', '품목 CIS', ', '.join(names), f'서로 다른 품목이 같은 코드 {code}', '맞는지 확인')

    # 6. 목록에서 고를 수 있는데 품목(CIS 코드 이름)이 없는 것 → PPT에 '확인필요'
    def need(values, area, chars=' .-'):
        for v in values or []:
            v = _clean(v)
            if v and master.code(spec._code_key(v, chars)) == '확인필요':
                _issue(out, 'ask', '품목 없음', v, f'{area}로 고를 수 있는데 품목 CIS 코드가 없음 (PPT에 확인필요)',
                       '품목·CIS 코드 추가')
    need(models, '서버 모델', ' .-(')
    for name, m in lists.items():
        if name.startswith('스토리지모델_'):
            need(m.values, '스토리지 모델', ' .-(')
        elif name.startswith('모델_'):
            need(m.values, 'ETC·NW 모델', ' .-(')
        elif name.startswith('GPU_'):
            need(m.values, 'GPU')
    need(get('MEMORY'), '메모리')
    # CPU는 CPU 사양의 이름으로 (E-2224 → Xeon E-2224처럼 표기가 다르면 위 'CPU 이름'에서 따로 알림)
    cpu_values = {_clean(v) for n, m in lists.items() if n.startswith('List_') for v in m.values if _clean(v)}
    need(sorted({cpu_names.get(v.upper()) or next((n for n in cpu_names.values()
                                                  if spec.Master.model_no(n) == spec.Master.model_no(v)), v)
                 for v in cpu_values}), 'CPU')
    # 스토리지 워런티
    for name, m in lists.items():
        if name.startswith('스토리지모델_'):
            for v in m.values:
                if _clean(v) and master.code(spec._code_key(f'{_clean(v)}_WAR', ' .-(')) == '확인필요':
                    _issue(out, 'ask', '품목 없음', f'{_clean(v)} WAR', '스토리지 워런티 품목 CIS 코드가 없음', '품목·CIS 코드 추가')

    # 8. 품목 CIS에는 있는데 어느 목록에서도 고를 수 없는 장비 모델 (오타 또는 목록 누락)
    all_values = {_norm(v) for m in lists.values() for v in m.values}
    all_values |= {_norm(c.name) for c in cpus}
    disk_types = tuple(_norm(t) for t in (get('DiskType') or []) + ['SSD'])
    for p in codes:
        n = _norm(p.name)
        if n.endswith('WAR') or n.startswith(disk_types) or n in all_values:
            continue
        if any(n.startswith(_norm(prod)) for m in lists.values() if m.name.startswith('SW_') for prod in m.values):
            continue  # 라이선스 품목 (제품 + 버전 + 에디션)
        similar = [v for m in lists.values() for v in m.values if _clean(v) and spec.Master.model_no(v)
                   and spec.Master.model_no(v) == spec.Master.model_no(p.name)]
        _issue(out, 'ask', '품목 CIS', p.name, '품목은 있는데 어느 선택 목록에도 없음',
               f"목록 값 '{similar[0]}'과(와) 같은 것인지 확인" if similar else '목록에 추가하거나 품목 삭제')
    # 서버 워런티
    for maker in get('제조사_서버') or []:
        if master.code(f'code_{_clean(maker)}서버_WAR') == '확인필요':
            _issue(out, 'ask', '품목 없음', f'{_clean(maker)}서버 WAR', '서버 워런티 품목 CIS 코드가 없음', '품목·CIS 코드 추가')

    # 7. 라이선스 제품의 버전·에디션 목록
    done = set()
    for kind_list in [n for n in lists if n.startswith('제조사_') and n[4:] in ('OS', 'Hypervisor', 'HA', 'DBMS')]:
        for maker in get(kind_list) or []:
            if _clean(maker) in done:
                continue
            done.add(_clean(maker))
            products = get(f'SW_{_clean(maker)}')
            if products is None:
                _issue(out, 'ask', '라이선스', _clean(maker), f'{kind_list[4:]} 제조사인데 SW_{_clean(maker)} 제품 목록이 없음',
                       '제품 목록 추가')
                continue
            for prod in products:
                for suffix, word in (('_ver', '버전'), ('_Edition', '에디션')):
                    if get(f'{_us(prod)}{suffix}') is None:
                        _issue(out, 'info', '라이선스', _clean(prod), f'{word} 목록({_us(prod)}{suffix})이 없음')

    order = {'fix': 0, 'ask': 1, 'info': 2}
    out.sort(key=lambda i: (order[i['level']], i['area'], i['target']))
    return out


def apply_safe():
    """공백·빈 값·중복만 정리한다. 바꾼 내용 목록을 돌려준다"""
    changes = []
    with transaction.atomic():
        for m in MasterList.objects.all():
            new, seen = [], set()
            for v in m.values:
                s = _clean(v)
                if not s or s.lower() in seen:
                    continue
                seen.add(s.lower())
                new.append(s)
            if new != m.values:
                changes.append({'area': '선택 목록', 'target': m.name, 'before': m.values, 'after': new})
                m.values = new
                m.save()
        for c in CpuSpec.objects.all():
            name = _clean(c.name)
            if name != c.name and not CpuSpec.objects.filter(name=name).exists():
                changes.append({'area': 'CPU 사양', 'target': c.name, 'before': c.name, 'after': name})
                c.name = name
                c.save()
        for p in PartCode.objects.all():
            name, code = _clean(p.name), p.cis_code.strip()
            if (name, code) != (p.name, p.cis_code) and (name == p.name or not PartCode.objects.filter(name=name).exists()):
                changes.append({'area': '품목 CIS', 'target': p.name, 'before': [p.name, p.cis_code], 'after': [name, code]})
                p.name, p.cis_code = name, code
                p.save()
    return changes
