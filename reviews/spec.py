"""
화면에서 입력한 구매 사양 ↔ 엑셀

- compute(items, ...)        : 엑셀 수식이 하던 계산 (장비 구분, Total, Guest 수량, SW-수량산정, 라이선스 수량, CIS 코드)
- build_workbook(case, items): 입력값으로 '구매 사양'·'SW-수량산정'·'CPU 호환 모델' 시트를 만든다.
                               칸 배치는 심의 매크로 엑셀(V3)과 같아서 기존 PPT 엔진(make_ppt)이 그대로 읽는다.
- read_items(data)           : 올린 매크로 엑셀의 '구매 사양'·'SW-수량산정' 시트를 화면 입력 줄로 옮긴다.

items는 dict 목록이다. 키: block, kind, name, usage, maker, model, qty, note, data (models.SpecItem 설명 참고)
"""
import math
import re

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import column_index_from_string, get_column_letter

SRC_SHEET = '구매 사양'
SW_SHEET = 'SW-수량산정'
CPU_SHEET = 'CPU 호환 모델'

BLOCKS = ['server', 'storage', 'etc', 'nw', 'license']
BLOCK_LABEL = {'server': '서버', 'storage': '스토리지', 'etc': 'ETC', 'nw': 'NW', 'license': 'License'}

# ---------------------------------------------------------------------------
# SW-수량산정 제품 (엑셀 SW-수량산정 시트 J~T열과 같은 순서)
#   rule: 자동 계산 규칙. manual = 서버마다 직접 입력한 수량을 더함
# ---------------------------------------------------------------------------
SW_PRODUCTS = [
    {'key': 'win_vl', 'group': 'OS', 'name': 'Microsoft Windows Server 2025 VL', 'unit': '2Core당 1 Copy', 'rule': 'win_2core'},
    {'key': 'win_dsp', 'group': 'OS', 'name': 'Microsoft Windows Server 2022 DSP', 'unit': '16Core당 1 Copy', 'rule': 'win_16core'},
    {'key': 'rhel', 'group': 'OS', 'name': 'Red Hat Enterprise Linux Standard 5Yr', 'unit': '2SKT(2VM) 당 1 Copy', 'rule': 'rhel'},
    {'key': 'vsphere', 'group': 'Vmware', 'name': 'VMw vSphere Std', 'unit': 'Socket 당 1 Copy', 'rule': 'socket'},
    {'key': 'vcenter', 'group': 'Vmware', 'name': 'VMware vCenter Server Standard (per Instance)', 'unit': '인스턴스 당 1 Copy', 'rule': 'manual'},
    {'key': 'roseha_win', 'group': 'HA', 'name': 'RoseHA for Windows Server Edition (SAN)', 'unit': '이중화 구성 당 1 Copy', 'rule': 'manual'},
    {'key': 'rose_mirror', 'group': 'HA', 'name': 'Rose Mirror HA for Windows Server', 'unit': '이중화 구성 당 1 Copy', 'rule': 'manual'},
    {'key': 'roseha_linux', 'group': 'HA', 'name': 'RoseHA for Linux Server Edition (SAN)', 'unit': '이중화 구성 당 1 Copy', 'rule': 'manual'},
    {'key': 'oracle_ee', 'group': 'DBMS', 'name': 'Oracle19C Enterprise', 'unit': 'Copy (250NUP용)', 'rule': 'manual'},
    {'key': 'oracle_se', 'group': 'DBMS', 'name': 'Oracle19C Standard', 'unit': '소켓당 1 Copy', 'rule': 'manual'},
    {'key': 'mssql', 'group': 'DBMS', 'name': 'MS-SQL 2022', 'unit': 'Device 당 1 Copy', 'rule': 'manual'},
]
SW_KEYS = [p['key'] for p in SW_PRODUCTS]
SW_BY_KEY = {p['key']: p for p in SW_PRODUCTS}
SW_FIRST_COL = 10  # J열

ETC_KINDS = ['SAN', 'Rack', 'PDU', 'KVM']
NW_KINDS = ['1G L2 Switch', '10G L2 Switch', '25G L3 Switch']
LICENSE_KINDS = ['OS', 'HyperVisor', 'HA', 'DBMS']


# ---------------------------------------------------------------------------
# 값 다루기
# ---------------------------------------------------------------------------
def num(v):
    """숫자로 바꾼다. 비었거나 숫자가 아니면 None ('2EA'처럼 숫자로 시작하면 앞 숫자)"""
    if v is None or v == '' or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.match(r'\s*(-?\d+(?:\.\d+)?)', str(v))
    return float(m.group(1)) if m else None


def clean_num(v):
    """화면·엑셀에 쓸 숫자: 정수면 int, 아니면 소수점 아래 불필요한 0 없이"""
    if v is None:
        return None
    v = round(float(v), 6)
    return int(v) if v.is_integer() else v


def text(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    # 엑셀 오류값(#REF!, #N/A ...)은 빈칸
    return '' if re.match(r'^#[A-Z/0!?]+[!?A]?$', s) else s


def roundup(x):
    return math.ceil(x - 1e-9)


def _code_key(text_, chars):
    s = text_
    for ch in chars:
        s = s.replace(ch, '_')
    return 'code_' + s


class Master:
    """기준정보 조회 (CPU 클럭·코어, CIS 코드)"""

    def __init__(self, cpus=None, codes=None):
        # cpus: {이름: (클럭, 코어)}, codes: {이름 관리자 이름(code_*): CIS 코드}
        self.cpus = cpus or {}
        self.by_upper = {k.upper(): v for k, v in self.cpus.items()}
        self.by_model = {}
        for k, v in self.cpus.items():
            m = self.model_no(k)
            if m:
                self.by_model.setdefault(m, v)
        # 엑셀 이름 관리자처럼 대소문자를 구분하지 않음 (code_Unity380H = code_UNITY380H)
        self.codes = {k.upper(): v for k, v in (codes or {}).items()}

    @classmethod
    def from_db(cls):
        from .models import CpuSpec, PartCode
        return cls({c.name: (c.clock, c.cores) for c in CpuSpec.objects.all()},
                   {p.key: p.cis_code for p in PartCode.objects.all() if p.key})

    @staticmethod
    def model_no(txt):
        m = re.search(r'\d{4}[A-Z]*', (txt or '').upper())
        return m.group(0) if m else ''

    def cpu(self, name):
        name = (name or '').strip()
        if not name:
            return None
        return self.by_upper.get(name.upper()) or self.by_model.get(self.model_no(name))

    def code(self, key):
        """CIS 코드. 이름이 없으면 '확인필요', 이름은 있는데 코드가 비어 있으면 빈칸 (엑셀 수식과 같은 결과)"""
        return self.codes.get(key.upper(), '확인필요')


# ---------------------------------------------------------------------------
# 계산 (엑셀 수식 대체)
# ---------------------------------------------------------------------------
def default_name(item):
    """ETC·NW 장비명·용도 자동 (엑셀 C·D열 IFS 수식)"""
    kind = (item.get('kind') or '')
    if item['block'] == 'etc':
        for k, name, use in (('SAN', 'SAN스위치', '스토리지 통신용'), ('RACK', 'Rack', '서버 및 장비 실장'),
                             ('PDU', 'PDU', '전원 분배 및 공급'), ('KVM', 'KVM', '콘솔 제어 및 유지보수')):
            if k in kind.upper():
                return name, use
        return '_', '_'
    if item['block'] == 'nw':
        for k, name, use in (('1G', '1G L2 스위치', '1G Private용 스위치'), ('25G', '25G L3 스위치', '25G Private용 스위치'),
                             ('10G', '10G L2 스위치', '10G Private용 스위치')):
            if k in kind.upper():
                return name, use
        return '_', '_'
    return '', ''


def _mem_gb(spec):
    m = re.search(r'(\d+)\s*(?:GB)?\s*$', spec or '', re.I)
    return float(m.group(1)) if m else None


def _mul(a, b):
    a, b = num(a), num(b)
    return clean_num(a * b) if a is not None and b is not None else None


# 서버 부품: 디스크·HBA·NIC·GPU는 줄마다 필요한 만큼 넣는다 (예전 Disk1·Disk2 고정 칸 형식도 읽음)
PART_FIELDS = {'disks': ('type', 'size', 'unit', 'qty'), 'hbas': ('model', 'qty'), 'nics': ('model', 'qty'),
               'gpus': ('model', 'qty')}
_OLD_PART = {'hbas': 'hba', 'nics': 'nic', 'gpus': 'gpu'}
SERVER_KEYS = ('os', 'cpu', 'cpu_qty', 'mem', 'mem_qty', 'vm_win', 'vm_linux', 'core')
MAX_PARTS = 20


def _filled(part):
    return any(text(v) for v in part.values())


def server_parts(d):
    """서버 사양(JSON)에서 부품 목록 {'disks': [...], 'hbas': [...], 'nics': [...], 'gpus': [...]}"""
    d = d or {}
    out = {}
    for key, fields in PART_FIELDS.items():
        if isinstance(d.get(key), list):
            parts = [{f: p.get(f, '') for f in fields} for p in d[key] if isinstance(p, dict)]
        elif key == 'disks':
            parts = [{'type': d.get(f'disk{n}_type') or '', 'size': d.get(f'disk{n}', ''),
                      'unit': d.get(f'disk{n}_unit') or '', 'qty': d.get(f'disk{n}_qty', '')} for n in (1, 2)]
        else:
            old = _OLD_PART[key]
            parts = [{'model': d.get(old) or '', 'qty': d.get(f'{old}_qty', '')}]
        out[key] = [p for p in parts if _filled({k: v for k, v in p.items() if k != 'unit'})][:MAX_PARTS]
    return out


def normalize_server(d):
    """예전 형식(disk1·hba 등 고정 칸)을 부품 목록 형식으로 바꾼다"""
    d = d or {}
    out = {k: d.get(k, '') for k in SERVER_KEYS}
    out['sw'] = d.get('sw') if isinstance(d.get('sw'), dict) else {}
    out.update(server_parts(d))
    return out


def server_calc(item, master):
    d = item.get('data') or {}
    parts = server_parts(d)
    os_name = d.get('os') or ''
    is_vm = 'VSPHERE' in os_name.upper()
    spec = master.cpu(d.get('cpu'))
    clock, cores = (spec if spec else ('', ''))
    mem_gb = _mem_gb(d.get('mem'))
    cpu_qty = num(d.get('cpu_qty')) or 0
    win, linux, core = num(d.get('vm_win')), num(d.get('vm_linux')), num(d.get('core'))
    # SW-수량산정 시트 J~T열 수식
    sw = {}
    base_w = (roundup(win / 2) if is_vm else win) if win is not None else None
    sw['win_vl'] = 0 if win is None else base_w * (max(16, core or 0) / 2)
    sw['win_dsp'] = 0 if win is None else roundup(base_w * max(16, core or 0) / 16)
    sw['rhel'] = 0 if linux is None else (roundup(linux / 2) if is_vm else roundup(cpu_qty / 2))
    sw['vsphere'] = cpu_qty if is_vm else 0
    manual = d.get('sw') or {}
    for p in SW_PRODUCTS:
        if p['rule'] == 'manual':
            sw[p['key']] = num(manual.get(p['key'])) or 0
    guest = clean_num((win or 0) + (linux or 0)) if is_vm and (win or linux) else None
    return {
        'usage': 'Hypervisor' if is_vm else 'BareMetal',
        'vm': is_vm,
        'clock': text(clock) or '-', 'cores': text(cores) or '-',
        'mem_total': clean_num(mem_gb * num(d.get('mem_qty'))) if mem_gb is not None and num(d.get('mem_qty')) is not None else None,
        'disks': [{'total': _mul(p.get('size'), p.get('qty')),
                   'code': master.code(_disk_key(p.get('type'), p.get('size'))) if p.get('type') else ''}
                  for p in parts['disks']],
        'gpus': [{'code': master.code(_code_key(text(p.get('model')), ' .-')) if text(p.get('model')) else ''}
                 for p in parts['gpus']],
        'guest': guest,
        'sw': {k: clean_num(v) for k, v in sw.items()},
        'codes': {
            'svr': master.code(_code_key((item.get('model') or '').strip(), ' .-(')) if item.get('model') else '',
            'cpu': master.code(_code_key(d.get('cpu') or '', ' .-')) if d.get('cpu') else '',
            'ram': master.code(_code_key(d.get('mem') or '', ' .-')) if d.get('mem') else '',
            'war': master.code(f"code_{item.get('maker')}서버_WAR") if item.get('maker') else '',
        },
    }


def _disk_key(dtype, size):
    s = f"{dtype}_{text(size).upper().replace('GB', '').replace('TB', '')}"
    return _code_key(s, ' .')


def storage_calc(item, master):
    disks = []
    for dk in (item.get('data') or {}).get('disks') or []:
        size, count, ratio = num(dk.get('size')), num(dk.get('count')), num(dk.get('ratio'))
        disks.append({
            'total': clean_num(size * count) if size is not None and count is not None else None,
            'usable': clean_num(size * (count - 2) * ratio) if None not in (size, count, ratio) else None,
            'code': master.code(_disk_key(dk.get('type'), dk.get('size'))) if dk.get('type') else '',
        })
    model = (item.get('model') or '').strip()
    return {'disks': disks, 'codes': {
        'war': master.code(f'code_{model}_WAR') if model else '',
        'sto': master.code(_code_key(model, ' .-(')) if model else '',
    }}


def compute(items, master=None):
    """줄마다 계산값(calc)과 SW 합계를 돌려준다: {'rows': [calc...], 'sw_total': {키: 수량}}"""
    master = master or Master()
    rows, sw_total = [], {k: 0 for k in SW_KEYS}
    for it in items:
        if it['block'] == 'server':
            c = server_calc(it, master)
            for k, v in c['sw'].items():
                sw_total[k] += v or 0
        elif it['block'] == 'storage':
            c = storage_calc(it, master)
        else:
            c = {}
            if it['block'] in ('etc', 'nw'):
                name, use = default_name(it)
                c['name'], c['usage'] = name, use
                c['codes'] = {'etc': master.code(_code_key((it.get('model') or '').strip(), ' .-('))}
        rows.append(c)
    sw_total = {k: clean_num(v) for k, v in sw_total.items()}
    # License: 수량 산정 기준(basis)이 있으면 SW-수량산정 합계를 수량으로
    for it, c in zip(items, rows):
        if it['block'] != 'license':
            continue
        d = it.get('data') or {}
        basis = d.get('basis') or ''
        c['qty'] = sw_total.get(basis) if basis in SW_BY_KEY else clean_num(num(it.get('qty')))
        c['license'] = 'subscription' if '구독' in (it.get('model') or '') else 'Perpetual'
        c['unit'] = SW_BY_KEY[basis]['unit'] if basis in SW_BY_KEY else ''
        sw_name = ' '.join(x for x in (text(it.get('model')), text(d.get('version')), text(d.get('edition'))) if x)
        c['codes'] = {'sw': master.code(_code_key(sw_name, ' .-()')) if sw_name else ''}
    return {'rows': rows, 'sw_total': sw_total}


# ---------------------------------------------------------------------------
# 엑셀 만들기 (V3 매크로 엑셀과 같은 칸 배치)
# ---------------------------------------------------------------------------
# 1·2행 헤더: (열, 1행, 2행)
SPEC_HEADER = [
    ('A', '업무', ''), ('B', '유형', ''), ('C', '장비명', ''), ('D', '장비\n구분', ''), ('E', '제조사', ''),
    ('F', 'Model', ''), ('G', '수량', ''), ('H', 'Guest\n수량', ''), ('I', 'OS', ''),
    ('J', 'CPU', '모델'), ('K', '', '속도(GHz)'), ('L', '', 'core'), ('M', '', '수량'),
    ('N', 'MEMORY', 'Total(GB)'), ('O', '', '구매 사양'), ('P', '', '수량'),
    ('Q', 'Disk1(GB)', 'Total(GB)'), ('R', '', 'Type'), ('S', '', '구매 사양'), ('T', '', '수량'),
    ('U', 'Disk2(GB)', 'Total(GB)'), ('V', '', 'Type'), ('W', '', '구매 사양'), ('X', '', '수량'),
    ('Y', 'HBA', '제품'), ('Z', '', '수량'), ('AA', 'NIC 01', '종류'), ('AB', '', '수량'),
    ('AC', 'GPU', '제품'), ('AD', '', '수량'), ('AE', '비고', ''),
    ('AF', 'Server CIS-CODE', ''), ('AG', 'CPU CIS-CODE', ''), ('AH', 'RAM CIS-CODE', ''),
    ('AI', 'DISK1 CIS-CODE', ''), ('AJ', 'DISK2 CIS-CODE', ''), ('AK', 'GPU CIS-CODE', ''),
    ('AL', '워런티 CIS-CODE', ''), ('AM', 'STORAGE CIS-CODE', ''), ('AN', 'ETC CIS-CODE', ''), ('AO', 'SW CIS-CODE', ''),
]
HEADER_MERGE = ['J1:M1', 'N1:P1', 'Q1:T1', 'U1:X1', 'Y1:Z1', 'AA1:AB1', 'AC1:AD1']
SUB_HEADERS = {
    'storage': {'A': '업무', 'B': '유형', 'C': '장비명', 'D': '용도', 'E': '제조사', 'F': 'Model', 'G': '수량',
                'H': 'Type', 'I': 'Total', 'J': '디스크(TB)', 'K': ' 수량', 'L': '가용율', 'N': 'usable', 'AE': '비고'},
    'etc': {'A': '업무', 'B': '유형', 'C': '장비명', 'D': '용도', 'E': '제조사', 'F': 'Model', 'G': '수량', 'I': 'Spec', 'AE': '비고'},
    'license': {'A': '업무', 'B': '유형', 'C': '장비명', 'D': '용도', 'E': '제조사', 'F': 'Model', 'G': '수량',
                'I': '버전', 'J': 'Edition', 'K': '라이선스', 'L': '라이선스 단위', 'AE': '비고'},
}
SUB_HEADERS['nw'] = SUB_HEADERS['etc']

_thin = Side(style='thin', color='BFBFBF')
BORDER = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)
HEAD_FILL = PatternFill('solid', fgColor='DDEBF7')
SUB_FILL = PatternFill('solid', fgColor='F2F2F2')
TOTAL_FILL = PatternFill('solid', fgColor='FFF2CC')
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)


def _put(ws, ref, value, unit=None, whole=False):
    if value is None or value == '':
        return
    ws[ref] = value
    if unit and isinstance(value, (int, float)):
        ws[ref].number_format = unit_format(value, unit, whole)


def unit_format(value, unit, whole=False):
    """3.2 + TB → 0.0"TB" (엑셀에 3.2TB로 보이게). whole=True면 소수점 없이 (usable 등)"""
    frac = '' if whole or float(value).is_integer() else str(clean_num(value)).split('.')[1]
    return ('0.' + '0' * len(frac) if frac else '0') + f'"{unit}"'


def _style_row(ws, r, last_col, fill=None, bold=False):
    for c in range(1, last_col + 1):
        cell = ws.cell(r, c)
        cell.border = BORDER
        cell.alignment = CENTER
        if fill:
            cell.fill = fill
        if bold:
            cell.font = Font(bold=True)


def _sorted(items, block):
    return [it for it in items if it['block'] == block]


def build_workbook(case_title, items, master=None, cpus=None):
    """화면 입력값 → 엑셀(openpyxl Workbook). 수식 대신 계산값을 넣는다"""
    master = master or Master()
    calc = compute(items, master)
    calc_of = {id(it): c for it, c in zip(items, calc['rows'])}

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SRC_SHEET
    last_col = column_index_from_string('AO')
    for col, h1, h2 in SPEC_HEADER:
        _put(ws, f'{col}1', h1)
        _put(ws, f'{col}2', h2)
        if not h2 and col not in ('K', 'L', 'M'):
            ws.merge_cells(f'{col}1:{col}2')
    for m in HEADER_MERGE:
        ws.merge_cells(m)
    _style_row(ws, 1, last_col, HEAD_FILL, True)
    _style_row(ws, 2, last_col, HEAD_FILL, True)

    r = 3
    sw_rows = []  # SW-수량산정 시트용 (서버 줄, 계산값)

    def sub_header(block):
        nonlocal r
        for col, v in SUB_HEADERS[block].items():
            ws[f'{col}{r}'] = v
        _style_row(ws, r, last_col, SUB_FILL, True)
        r += 1

    def block_label(first_row, last_row, label):
        ws[f'A{first_row}'] = label
        if last_row > first_row:
            ws.merge_cells(f'A{first_row}:A{last_row}')

    # 서버
    servers = _sorted(items, 'server')
    start = r
    for it in servers:
        d, c = it.get('data') or {}, calc_of[id(it)]
        parts = server_parts(d)
        vals = {
            'B': '서버', 'C': it.get('name'), 'D': it.get('usage') or c['usage'], 'E': it.get('maker'),
            'F': it.get('model'), 'G': clean_num(num(it.get('qty'))), 'H': c['guest'], 'I': d.get('os'),
            'J': d.get('cpu'), 'K': c['clock'] if d.get('cpu') else None, 'L': c['cores'] if d.get('cpu') else None,
            'M': clean_num(num(d.get('cpu_qty'))), 'O': d.get('mem'), 'P': clean_num(num(d.get('mem_qty'))),
            'AE': it.get('note'), 'AF': c['codes']['svr'], 'AG': c['codes']['cpu'], 'AH': c['codes']['ram'],
            'AL': c['codes']['war'],
        }
        for col, v in vals.items():
            _put(ws, f'{col}{r}', v)
        _put(ws, f'N{r}', c['mem_total'], 'GB')
        # 부품이 칸(Disk 2개, HBA·NIC·GPU 1개)보다 많으면 아래 행(유형 칸 비움)에 이어서 적는다
        #   PPT 엔진은 유형이 빈 아래 행을 같은 서버의 추가 부품으로 읽는다
        n_rows = max(1, math.ceil(len(parts['disks']) / 2), len(parts['hbas']), len(parts['nics']), len(parts['gpus']))
        for j in range(n_rows):
            rr = r + j
            for slot, (tot, typ, size, qty, code) in enumerate((('Q', 'R', 'S', 'T', 'AI'), ('U', 'V', 'W', 'X', 'AJ'))):
                i = 2 * j + slot
                if i >= len(parts['disks']):
                    continue
                p, pc = parts['disks'][i], c['disks'][i]
                unit = p.get('unit') or ''
                _put(ws, f'{tot}{rr}', pc['total'], unit)
                _put(ws, f'{typ}{rr}', p.get('type'))
                _put(ws, f'{size}{rr}', clean_num(num(p.get('size'))), unit)
                _put(ws, f'{qty}{rr}', clean_num(num(p.get('qty'))))
                _put(ws, f'{code}{rr}', pc['code'])
            for key, col, qcol in (('hbas', 'Y', 'Z'), ('nics', 'AA', 'AB'), ('gpus', 'AC', 'AD')):
                if j < len(parts[key]):
                    _put(ws, f'{col}{rr}', text(parts[key][j].get('model')) or None)
                    _put(ws, f'{qcol}{rr}', clean_num(num(parts[key][j].get('qty'))))
            if j < len(parts['gpus']):
                _put(ws, f'AK{rr}', c['gpus'][j]['code'])
            _style_row(ws, rr, last_col)
        sw_rows.append((it, c))
        r += n_rows
    if servers:
        block_label(start, r - 1, case_title)
    ws[f'B{r}'] = '서버 소계'
    ws.merge_cells(f'B{r}:F{r}')
    ws[f'G{r}'] = clean_num(sum(num(it.get('qty')) or 0 for it in servers))
    _style_row(ws, r, last_col, TOTAL_FILL, True)
    r += 1

    # 스토리지 (디스크 줄마다 한 행, 첫 행에만 장비 정보)
    storages = _sorted(items, 'storage')
    if storages:
        sub_header('storage')
        start = r
        for it in storages:
            c = calc_of[id(it)]
            disks = (it.get('data') or {}).get('disks') or [{}]
            first = r
            for i, dk in enumerate(disks):
                dc = c['disks'][i] if i < len(c['disks']) else {}
                if i == 0:
                    for col, v in {'B': '스토리지', 'C': it.get('name'), 'D': it.get('usage'), 'E': it.get('maker'),
                                   'F': it.get('model'), 'G': clean_num(num(it.get('qty'))), 'AE': it.get('note')}.items():
                        _put(ws, f'{col}{r}', v)
                for col, v in {'H': dk.get('type'), 'K': clean_num(num(dk.get('count'))),
                               'AI': dc.get('code'), 'AL': c['codes']['war'], 'AM': c['codes']['sto']}.items():
                    _put(ws, f'{col}{r}', v)
                unit = dk.get('unit') or ''
                _put(ws, f'I{r}', dc.get('total'), unit, whole=True)
                _put(ws, f'J{r}', clean_num(num(dk.get('size'))), unit)
                _put(ws, f'N{r}', dc.get('usable'), unit, whole=True)
                _put(ws, f'L{r}', clean_num(num(dk.get('ratio'))))
                if num(dk.get('ratio')) is not None:
                    ws[f'L{r}'].number_format = '0.0%'
                _style_row(ws, r, last_col)
                r += 1
            if r - 1 > first:
                for col in 'BCDEFG':
                    ws.merge_cells(f'{col}{first}:{col}{r - 1}')
        block_label(start, r - 1, '스토리지')
        ws[f'B{r}'] = 'Storage 소계'
        ws.merge_cells(f'B{r}:F{r}')
        ws[f'G{r}'] = clean_num(sum(num(it.get('qty')) or 0 for it in storages))
        _style_row(ws, r, last_col, TOTAL_FILL, True)
        r += 1

    # ETC, NW
    for block, label in (('etc', 'ETC'), ('nw', 'NW')):
        rows = _sorted(items, block)
        if not rows:
            continue
        sub_header(block)
        start = r
        for it in rows:
            c = calc_of[id(it)]
            for col, v in {'B': it.get('kind'), 'C': it.get('name') or c['name'], 'D': it.get('usage') or c['usage'],
                           'E': it.get('maker'), 'F': it.get('model'), 'G': clean_num(num(it.get('qty'))),
                           'I': (it.get('data') or {}).get('spec'), 'AE': it.get('note'), 'AN': c['codes']['etc']}.items():
                _put(ws, f'{col}{r}', v)
            _style_row(ws, r, last_col)
            r += 1
        block_label(start, r - 1, label)

    # License
    licenses = _sorted(items, 'license')
    if licenses:
        sub_header('license')
        start = r
        for it in licenses:
            d, c = it.get('data') or {}, calc_of[id(it)]
            for col, v in {'B': it.get('kind'), 'C': it.get('name') or '-', 'D': it.get('usage') or it.get('kind'),
                           'E': it.get('maker'), 'F': it.get('model'), 'G': c['qty'] if c['qty'] is not None else 0,
                           'I': _num_or_text(d.get('version')), 'J': d.get('edition'), 'K': c['license'], 'L': c['unit'],
                           'AE': it.get('note'), 'AO': c['codes']['sw']}.items():
                _put(ws, f'{col}{r}', v)
            ws.merge_cells(f'L{r}:M{r}')
            _style_row(ws, r, last_col)
            r += 1
        block_label(start, r - 1, 'License')

    widths = {'A': 10, 'B': 12, 'C': 14, 'D': 12, 'E': 11, 'F': 16, 'I': 16, 'J': 16, 'O': 11, 'AE': 18}
    for c in range(1, last_col + 1):
        letter = get_column_letter(c)
        ws.column_dimensions[letter].width = widths.get(letter, 13 if c >= 32 else 8)
    ws.freeze_panes = 'C3'

    _sw_sheet(wb.create_sheet(SW_SHEET), case_title, sw_rows, calc['sw_total'])
    _cpu_sheet(wb.create_sheet(CPU_SHEET), cpus if cpus is not None else master.cpus)
    return wb


def _num_or_text(v):
    n = num(v)
    return clean_num(n) if n is not None and re.fullmatch(r'\s*-?\d+(\.\d+)?\s*', str(v)) else (v or None)


def _sw_sheet(ws, case_title, rows, totals):
    heads = {'B1': '업무', 'C1': '유형', 'D1': '장비명', 'E1': 'CPU\n수량', 'F1': 'VM\n설치여부', 'G1': 'VM OS Type',
             'G3': 'Windows', 'H3': 'Linux', 'I1': 'Core \n수량', 'J1': 'OS', 'M1': 'Vmware', 'O1': 'HA', 'R1': 'DBMS',
             'U1': '비고', 'J2': 'Spec.', 'M2': 'Spec.', 'O2': 'Spec.', 'R2': 'Spec.'}
    for ref, v in heads.items():
        ws[ref] = v
    for i, p in enumerate(SW_PRODUCTS):
        col = get_column_letter(SW_FIRST_COL + i)
        ws[f'{col}3'] = p['name']
        ws[f'{col}4'] = p['unit']
    for m in ('B1:B4', 'C1:C4', 'D1:D4', 'E1:E4', 'F1:F4', 'I1:I4', 'U1:U4', 'G1:H2', 'G3:G4', 'H3:H4',
              'J1:L1', 'J2:L2', 'M1:N1', 'M2:N2', 'O1:Q1', 'O2:Q2', 'R1:T1', 'R2:T2'):
        ws.merge_cells(m)
    for r in range(1, 5):
        _style_row(ws, r, 21, HEAD_FILL, True)
    r = 5
    for it, c in rows:
        d = it.get('data') or {}
        vals = {'C': '서버', 'D': it.get('name'), 'E': clean_num(num(d.get('cpu_qty'))), 'F': 'O' if c['vm'] else None,
                'G': clean_num(num(d.get('vm_win'))), 'H': clean_num(num(d.get('vm_linux'))), 'I': clean_num(num(d.get('core')))}
        for i, k in enumerate(SW_KEYS):
            v = c['sw'].get(k)
            vals[get_column_letter(SW_FIRST_COL + i)] = v if v else (0 if SW_BY_KEY[k]['rule'] != 'manual' else None)
        for col, v in vals.items():
            _put(ws, f'{col}{r}', v)
        _style_row(ws, r, 21)
        r += 1
    if rows:
        ws['B5'] = case_title
        if r - 1 > 5:
            ws.merge_cells(f'B5:B{r - 1}')
    ws[f'B{r}'] = '소계'
    ws.merge_cells(f'B{r}:I{r}')
    for i, k in enumerate(SW_KEYS):
        ws[f'{get_column_letter(SW_FIRST_COL + i)}{r}'] = totals.get(k) or 0
    _style_row(ws, r, 21, TOTAL_FILL, True)
    for c in range(1, 22):
        ws.column_dimensions[get_column_letter(c)].width = 16 if c >= SW_FIRST_COL else 10
    ws.row_dimensions[3].height = 45


def _cpu_sheet(ws, cpus):
    ws.append(['CPU', '속도(GHz)', 'core'])
    _style_row(ws, 1, 3, HEAD_FILL, True)
    for name, (clock, cores) in sorted(cpus.items()):
        ws.append([name, num(clock) if num(clock) is not None else clock, num(cores) if num(cores) is not None else cores])
    ws.column_dimensions['A'].width = 24


# ---------------------------------------------------------------------------
# 올린 엑셀 → 화면 입력 줄
# ---------------------------------------------------------------------------
SERVER_COLS = {
    'os': 'I', 'cpu': 'J', 'cpu_qty': 'M', 'mem': 'O', 'mem_qty': 'P',
    'disk1_type': 'R', 'disk1': 'S', 'disk1_qty': 'T', 'disk2_type': 'V', 'disk2': 'W', 'disk2_qty': 'X',
    'hba': 'Y', 'hba_qty': 'Z', 'nic': 'AA', 'nic_qty': 'AB', 'gpu': 'AC', 'gpu_qty': 'AD',
}
_SW_REF = re.compile(r"SW-수량산정'?!\$?([A-Z]+)\$?(\d+)")


def _block_of(a):
    u = a.upper().replace(' ', '')
    if u in ('스토리지', 'STORAGE'):
        return 'storage'
    if u == 'ETC':
        return 'etc'
    if u in ('NW', 'NETWORK'):
        return 'nw'
    if u in ('LICENSE', 'S/W', 'SW'):
        return 'license'
    return 'server'


def _cell_value(v):
    """숫자는 숫자 그대로, 글자는 다듬어서"""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return clean_num(v)
    return text(v)


def read_items(values_wb, formulas_wb=None):
    """매크로 엑셀(값으로 읽은 것, 수식으로 읽은 것) → (items, 경고 목록)"""
    if SRC_SHEET not in values_wb.sheetnames:
        raise ValueError(f"'{SRC_SHEET}' 시트가 없습니다.")
    ws = values_wb[SRC_SHEET]
    fws = formulas_wb[SRC_SHEET] if formulas_wb is not None and SRC_SHEET in formulas_wb.sheetnames else None
    # 열 밀림 보정 (make_ppt.Sheet와 같은 규칙): 1행에서 '유형' 헤더 위치로 칸 수 계산
    off = 0
    for c in range(1, min(ws.max_column, 10) + 1):
        if text(ws.cell(1, c).value) == '유형':
            off = max(0, c - 2)
            break

    def v(r, col):
        return _cell_value(ws.cell(r, column_index_from_string(col) + off).value)

    def raw(r, col):
        return ws.cell(r, column_index_from_string(col) + off).value

    items, warnings, block, last_storage, last_server = [], [], 'server', None, None
    sw_total_row = _sw_total_row(values_wb)
    for r in range(3, ws.max_row + 1):
        if ws.row_dimensions[r].hidden:
            continue
        a, b, c = v(r, 'A'), v(r, 'B'), v(r, 'C')
        a, b, c = text(a), text(b), text(c)
        if a == '업무' or b == '유형':
            continue
        if a:
            block = _block_of(a)
        if '소계' in b or '소계' in a:
            continue
        if not b:
            # 스토리지 아래 줄: 같은 스토리지의 추가 디스크
            if block == 'storage' and last_storage is not None and (v(r, 'H') or v(r, 'J') != ''):
                last_storage['data']['disks'].append(_storage_disk(v, r, ws.cell(r, column_index_from_string('J') + off)))
            # 서버 아래 줄: 같은 서버의 추가 디스크·HBA·NIC·GPU
            elif block == 'server' and last_server is not None:
                more = server_parts(_server_cols(v, ws, r, off))
                for key in PART_FIELDS:
                    last_server['data'][key] = (last_server['data'][key] + more[key])[:MAX_PARTS]
            continue
        if block == 'server' and b not in ('서버', 'SERVER', 'Server'):
            # 업무 칸이 비어 있는 다른 구역 (예: 업무명 없이 바로 License)
            if b.upper() in ('OS', 'HYPERVISOR', 'HA', 'DBMS'):
                block = 'license'
            else:
                warnings.append(f'{r}행: 유형 "{b}"을(를) 서버로 읽었습니다.')
        it = {'block': block, 'kind': b, 'name': c, 'usage': '', 'maker': text(v(r, 'E')), 'model': text(v(r, 'F')),
              'qty': num(raw(r, 'G')), 'note': text(v(r, 'AE')), 'data': {}}
        if block == 'server':
            it['kind'] = '서버'
            it['data'] = normalize_server(_server_cols(v, ws, r, off))
            last_server = it
        elif block == 'storage':
            it['kind'] = '스토리지'
            it['usage'] = text(v(r, 'D'))
            it['data'] = {'disks': [_storage_disk(v, r, ws.cell(r, column_index_from_string('J') + off))]}
            last_storage = it
        elif block in ('etc', 'nw'):
            auto_name, auto_use = default_name(it)
            if c == auto_name:
                it['name'] = ''
            d = text(v(r, 'D'))
            it['usage'] = '' if d == auto_use else d
            it['data'] = {'spec': text(v(r, 'I'))}
        else:
            it['name'] = '' if c == '-' else c
            d = text(v(r, 'D'))
            it['usage'] = '' if d == b else d
            basis = ''
            if fws is not None:
                m = _SW_REF.search(str(fws.cell(r, column_index_from_string('G') + off).value or ''))
                # SW-수량산정 '소계' 행을 가리킬 때만 자동 계산으로 본다 (다른 칸을 가리키면 값 그대로 직접 입력)
                if m and int(m.group(2)) == sw_total_row:
                    idx = column_index_from_string(m.group(1)) - SW_FIRST_COL
                    if 0 <= idx < len(SW_KEYS):
                        basis = SW_KEYS[idx]
            it['data'] = {'version': text(v(r, 'I')), 'edition': text(v(r, 'J')), 'basis': basis}
        items.append(it)

    _read_sw_sheet(values_wb, items, warnings)
    return items, warnings


def _server_cols(v, ws, r, off):
    d = {k: v(r, col) for k, col in SERVER_COLS.items()}
    d['disk1_unit'] = _unit_of(ws.cell(r, column_index_from_string('S') + off), 'TB')
    d['disk2_unit'] = _unit_of(ws.cell(r, column_index_from_string('W') + off), 'GB')
    return d


def _sw_total_row(wb):
    if SW_SHEET not in wb.sheetnames:
        return None
    ws = wb[SW_SHEET]
    for r in range(5, ws.max_row + 1):
        if '소계' in text(ws.cell(r, 2).value):
            return r
    return None


def _unit_of(cell, default=''):
    """칸의 표시 형식에서 단위(TB/GB)를 읽는다. 값이 비었거나 단위가 없으면 default"""
    fmt = (cell.number_format or '').upper()
    for u in ('TB', 'GB'):
        if f'"{u}"' in fmt:
            return u
    return default


def _storage_disk(v, r, size_cell):
    return {'type': text(v(r, 'H')), 'size': v(r, 'J'), 'unit': _unit_of(size_cell, 'TB'), 'count': v(r, 'K'),
            'ratio': v(r, 'L')}


def _read_sw_sheet(wb, items, warnings):
    """SW-수량산정 시트에서 서버별 VM 수·코어 수·직접 입력 제품 수량을 장비명으로 찾아 넣는다"""
    if SW_SHEET not in wb.sheetnames:
        return
    ws = wb[SW_SHEET]
    servers = {}
    for it in items:
        if it['block'] == 'server' and it['name']:
            servers.setdefault(it['name'].strip().upper(), it)
    for r in range(5, ws.max_row + 1):
        host = text(ws.cell(r, 4).value)
        if not host or '소계' in text(ws.cell(r, 2).value):
            continue
        it = servers.get(host.upper())
        if it is None:
            warnings.append(f"SW-수량산정 {r}행: 장비명 '{host}'을(를) 구매 사양에서 찾지 못해 건너뛰었습니다.")
            continue
        d = it['data']
        for key, col in (('vm_win', 7), ('vm_linux', 8), ('core', 9)):
            d[key] = _cell_value(ws.cell(r, col).value)
        for i, p in enumerate(SW_PRODUCTS):
            if p['rule'] == 'manual':
                n = num(ws.cell(r, SW_FIRST_COL + i).value)
                if n:
                    d['sw'][p['key']] = clean_num(n)
