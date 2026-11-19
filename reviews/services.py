"""투자심의 자료(ADB-Doc) 처리 로직: 기준정보 가져오기, PPT·배포용 엑셀 만들기."""
import datetime
import io
import re
import shutil
import tempfile
import traceback
from pathlib import Path

import openpyxl
from django.conf import settings
from django.core.files import File
from django.db import transaction
from django.utils import timezone

from assets.services import ValidationError
from . import spec
from .models import CpuSpec, MasterList, PartCode, PptTemplate, ReviewCase, ReviewOutput, SpecItem

MAX_EXCEL_SIZE = 20 * 1024 * 1024   # nginx client_max_body_size(20m)와 맞춤
EXCEL_EXT = ('.xlsx', '.xlsm')
SRC_SHEET = '구매 사양'
CPU_SHEET = 'CPU 호환 모델'


def _text(v):
    """셀 값을 화면에 보이는 문자열로 (정수형 실수는 소수점 없이)"""
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _is_error(v):
    return isinstance(v, str) and v.startswith('#') and v.endswith(('!', '?', 'A'))


def load_workbook(data):
    """업로드한 엑셀(bytes)을 값 기준으로 연다. 열 수 없으면 ValidationError"""
    try:
        return openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    except Exception as e:  # zip 손상, 암호(DRM) 걸린 파일 등
        raise ValidationError(
            f'엑셀 파일을 열 수 없습니다. 회사 보안(DRM)이 걸려 있으면 해제한 뒤 다시 올려 주세요. ({type(e).__name__})')


def check_upload(upload, exts=EXCEL_EXT, label='엑셀'):
    if not upload:
        raise ValidationError(f'{label} 파일을 선택해 주세요.')
    if not upload.name.lower().endswith(exts):
        raise ValidationError(f'{", ".join(exts)} 파일만 올릴 수 있습니다.')
    if upload.size > MAX_EXCEL_SIZE:
        raise ValidationError('파일이 너무 큽니다. (최대 20MB)')


# ---------------------------------------------------------------------------
# 기준정보 (이름 관리자) 가져오기
# ---------------------------------------------------------------------------
def list_group(name):
    """이름 관리자 이름으로 화면에 묶어 보여줄 분류를 정한다"""
    head = name.split('_')[0]
    if head == 'List':
        return 'CPU 호환 목록'
    if head in ('제조사', '서버모델', '스토리지모델', 'GPU'):
        return head
    if head in ('모델', 'Spec'):
        return '네트워크·랙·KVM'
    if head == 'SW':
        return 'SW 제품'
    if name.endswith(('_ver', '_Edition')):
        return 'SW 버전·에디션'
    return '기타'


_LABEL_WORDS = {'MEMORY': '메모리', 'DiskType': '디스크 종류'}


def list_label(name):
    """이름 관리자 이름 → 화면에 보일 이름 (엑셀 이름 규칙의 접두어·'_'·'Plus'를 사람이 읽는 형태로)
    예: List_DL380_Gen10Plus → DL380 Gen10+, 모델_스위치_DELL → 스위치 모델 · DELL, vSphere_구독_ver → vSphere 구독 버전"""
    def words(s):
        return re.sub(r'(?<=\d)Plus\b', '+', s.replace('_', ' ')).strip()
    head, _, rest = name.partition('_')
    if head in ('List', '제조사', '서버모델', '스토리지모델', 'GPU', 'SW') and rest:
        return words(rest)
    if head in ('모델', 'Spec') and rest:
        kind, _, maker = rest.partition('_')
        return f"{words(kind)} {'모델' if head == '모델' else '사양'}" + (f' · {words(maker)}' if maker else '')
    for suffix, word in (('_ver', '버전'), ('_Edition', '에디션')):
        if name.endswith(suffix):
            return f'{words(name[:-len(suffix)])} {word}'
    return _LABEL_WORDS.get(name, words(name))


def _range_values(wb, defined_name):
    """이름이 가리키는 범위의 값 목록 (빈칸·오류값 제외)과 (시트, 첫 셀 행, 열) 정보"""
    values, first = [], None
    for sheet, coord in defined_name.destinations:
        if sheet not in wb.sheetnames:
            continue
        cells = wb[sheet][coord.replace('$', '')]
        if not isinstance(cells, tuple):
            cells = ((cells,),)
        elif cells and not isinstance(cells[0], tuple):
            cells = (cells,)
        for row in cells:
            for cell in row:
                if first is None:
                    first = (sheet, cell.row, cell.column)
                v = cell.value
                if v in (None, '') or _is_error(v):
                    continue
                values.append(_text(v))
    return values, first


def read_master(wb):
    """매크로 엑셀에서 (품목 코드, 선택 목록, CPU 사양)을 읽는다"""
    codes, lists, cpus = {}, {}, {}
    for key, dn in wb.defined_names.items():
        if key.startswith('_') or _is_error(dn.attr_text or ''):
            continue
        try:
            values, first = _range_values(wb, dn)
        except Exception:  # 수식형 이름, 다른 파일 참조 등은 건너뜀
            continue
        if first is None:
            continue
        if key.startswith('code_'):
            sheet, row, col = first
            # DB 시트: G열 = 품목 이름, H열 = CIS 코드
            name = _text(wb[sheet].cell(row, col - 1).value) or key[5:]
            codes[name] = {'key': key, 'cis_code': values[0] if values else ''}
        else:
            lists[key] = {'group': list_group(key), 'values': values, 'source': dn.attr_text}
    if CPU_SHEET in wb.sheetnames:
        for row in wb[CPU_SHEET].iter_rows(min_row=2, values_only=True):
            name = _text(row[0] if row else '')
            if name and name not in cpus:
                cpus[name] = {'clock': _text(row[1]) if len(row) > 1 else '',
                              'cores': _text(row[2]) if len(row) > 2 else ''}
    return codes, lists, cpus


def _norm_key(v):
    return re.sub(r'\s+', ' ', str(v or '')).strip().lower()


def _merge(incoming, dry_run):
    """매크로 엑셀 값을 기준정보 DB에 합친다. DB가 기준이라 이미 있는 값은 바꾸거나 지우지 않는다.

    - 없는 품목·목록·CPU는 새로 만들고, 있는 목록에는 없는 값만 뒤에 붙인다
    - 비어 있는 칸(CIS 코드, 클럭·코어)만 엑셀 값으로 채운다
    - 화면·정리 명령으로 지우거나 이름을 바꾼 값은 변경 이력에 남아 있으므로 다시 넣지 않는다 (skipped)
    """
    codes, lists, cpus = incoming
    res = {k: {'added': 0, 'filled': 0, 'skipped': 0, 'total': len(v)}
           for k, v in (('codes', codes), ('lists', lists), ('cpus', cpus))}

    def gone_names(model):
        current = set(model.objects.values_list('name', flat=True))
        return {_norm_key(n) for n in model.history.values_list('name', flat=True).distinct() if n not in current}

    # 품목 CIS 코드
    existing = {_norm_key(p.name): p for p in PartCode.objects.all()}
    gone = gone_names(PartCode)
    for name, v in codes.items():
        p = existing.get(_norm_key(name))
        if p is None:
            if _norm_key(name) in gone:
                res['codes']['skipped'] += 1
                continue
            res['codes']['added'] += 1
            if not dry_run:
                PartCode.objects.create(name=name, key=v['key'], cis_code=v['cis_code'])
        elif not p.cis_code.strip() and v['cis_code'].strip():
            res['codes']['filled'] += 1
            if not dry_run:
                p.cis_code = v['cis_code']
                p.save()

    # 선택 목록
    existing = {m.name.lower(): m for m in MasterList.objects.all()}
    gone = gone_names(MasterList)
    for name, v in lists.items():
        m = existing.get(name.lower())
        if m is None:
            if _norm_key(name) in gone:
                res['lists']['skipped'] += 1
                continue
            res['lists']['added'] += 1
            if not dry_run:
                MasterList.objects.create(name=name, **v)
            continue
        have = {_norm_key(x) for x in m.values}
        removed = {_norm_key(x) for h in m.history.all() for x in (h.values or [])} - have
        new = []
        for x in v['values']:
            k = _norm_key(x)
            if k in have or k in {_norm_key(n) for n in new}:
                continue
            if k in removed:
                res['lists']['skipped'] += 1
                continue
            new.append(x)
        if new:
            res['lists']['added'] += len(new)
            if not dry_run:
                m.values = m.values + new
                m.save()

    # CPU 사양
    existing = {_norm_key(c.name): c for c in CpuSpec.objects.all()}
    gone = gone_names(CpuSpec)
    for name, v in cpus.items():
        c = existing.get(_norm_key(name))
        if c is None:
            if _norm_key(name) in gone:
                res['cpus']['skipped'] += 1
                continue
            res['cpus']['added'] += 1
            if not dry_run:
                CpuSpec.objects.create(name=name, **v)
        elif (not c.clock and v['clock']) or (not c.cores and v['cores']):
            res['cpus']['filled'] += 1
            if not dry_run:
                c.clock, c.cores = c.clock or v['clock'], c.cores or v['cores']
                c.save()
    return res


def import_master(data, dry_run=False):
    """심의 매크로 엑셀의 이름 관리자 내용을 기준정보 DB에 합친다 (DB가 기준: 없는 것만 추가, 빈칸만 채움)"""
    wb = load_workbook(data)
    codes, lists, cpus = read_master(wb)
    if not codes and not lists:
        raise ValidationError('이름 관리자 항목을 찾지 못했습니다. 심의 매크로 엑셀(.xlsm)이 맞는지 확인해 주세요.')
    with transaction.atomic():
        res = _merge((codes, lists, cpus), dry_run)
    if dry_run:
        res['missing_cis'] = sorted(n for n, v in codes.items() if not re.match(r'^Q4\w{2}-\w+$', v['cis_code'].strip()))
    return res


def add_list_value(name, value, clock='', cores=''):
    """선택 목록에 값 하나를 더한다 (목록이 없으면 새로 만든다). CPU 호환 목록이면 CPU 사양도 같이 넣는다"""
    name, value = str(name or '').strip(), str(value or '').strip()
    if not name or not value:
        raise ValidationError('목록 이름과 추가할 값을 입력해 주세요.')
    if len(name) > 150 or len(value) > 150:
        raise ValidationError('이름이나 값이 너무 깁니다.')
    is_cpu = name.startswith('List_')
    clock, cores = str(clock or '').strip(), str(cores or '').strip()
    if is_cpu and not CpuSpec.objects.filter(name=value).exists() and not (clock and cores):
        raise ValidationError('새 CPU는 클럭(GHz)과 코어 수도 입력해 주세요.')
    with transaction.atomic():
        lst, created = MasterList.objects.get_or_create(
            name=name, defaults={'group': list_group(name), 'values': [], 'source': '화면에서 추가'})
        if value not in lst.values:
            lst.values = [*lst.values, value]
            lst.save()
        if is_cpu and clock and cores:
            cpu, _ = CpuSpec.objects.get_or_create(name=value)
            if (cpu.clock, cpu.cores) != (clock, cores):
                cpu.clock, cpu.cores = clock, cores
                cpu.save()
    return list_dict(lst)


def list_dict(m):
    from .master_edit import part_category
    return {'id': m.id, 'name': m.name, 'label': list_label(m.name), 'group': m.group, 'values': m.values,
            'source': m.source, 'category': part_category(m.name)}


# ---------------------------------------------------------------------------
# 구매 사양 엑셀 → PPT, 배포용 엑셀
# ---------------------------------------------------------------------------
def read_case_info(wb):
    """구매 사양 시트에서 업무명을 읽어 온다 (없으면 빈 문자열)"""
    if SRC_SHEET not in wb.sheetnames:
        raise ValidationError(f"'{SRC_SHEET}' 시트가 없습니다. 투자심의 구매 사양 엑셀이 맞는지 확인해 주세요.")
    from .engine import make_ppt
    try:
        return {'title': make_ppt.task_name(make_ppt.Sheet(wb[SRC_SHEET]))}
    except Exception:
        return {'title': ''}


def attach_source(case, upload):
    """심의건에 구매 사양 엑셀을 붙인다 (예전 파일은 지움)"""
    check_upload(upload)
    data = upload.read()
    info = read_case_info(load_workbook(data))
    upload.seek(0)
    if case.source_excel:
        case.source_excel.delete(save=False)
    case.source_excel.save(upload.name, upload, save=False)
    case.source_name = upload.name
    case.source_uploaded_at = timezone.now()
    return info


def active_template():
    """PPT 템플릿 경로. 화면에서 올린 템플릿 → 설정(REVIEW_PPT_TEMPLATE) 순서"""
    tpl = PptTemplate.objects.filter(is_active=True).first()
    if tpl and tpl.file:
        return Path(tpl.file.path), tpl.name
    path = getattr(settings, 'REVIEW_PPT_TEMPLATE', '')
    if path and Path(path).is_file():
        return Path(path), Path(path).name
    return None, None


def safe_stem(text):
    return re.sub(r'[\\/:*?"<>|\s]+', '_', text or '').strip('_')[:60] or 'review'


# ---------------------------------------------------------------------------
# 화면에서 입력하는 구매 사양
# ---------------------------------------------------------------------------
ITEM_TEXT = {'kind': 50, 'name': 100, 'usage': 100, 'maker': 50, 'model': 100, 'note': 255}
MAX_ITEMS = 300


def item_dict(o):
    return {'id': o.id, 'block': o.block, 'kind': o.kind, 'name': o.name, 'usage': o.usage, 'maker': o.maker,
            'model': o.model, 'qty': spec.clean_num(o.qty), 'note': o.note,
            'data': spec.normalize_server(o.data) if o.block == 'server' else (o.data or {})}


def case_items(case):
    return [item_dict(o) for o in case.spec_items.all()]


def _clean_data(block, data):
    """구역별 사양(JSON): 정해진 키만, 글자는 200자까지"""
    if not isinstance(data, dict):
        return {}

    def val(v):
        if isinstance(v, bool) or v is None:
            return ''
        if isinstance(v, (int, float)):
            return spec.clean_num(v)
        return str(v).strip()[:200]

    if block == 'server':
        out = {k: val(data.get(k)) for k in spec.SERVER_KEYS}
        sw = data.get('sw') if isinstance(data.get('sw'), dict) else {}
        out['sw'] = {k: val(v) for k, v in sw.items() if k in spec.SW_BY_KEY and val(v) not in ('', 0)}
        for key, parts in spec.server_parts(data).items():
            out[key] = [{f: val(p.get(f)) for f in spec.PART_FIELDS[key]} for p in parts]
        return out
    if block == 'storage':
        disks = data.get('disks') if isinstance(data.get('disks'), list) else []
        return {'disks': [{k: val(d.get(k)) for k in ('type', 'size', 'unit', 'count', 'ratio')}
                          for d in disks[:20] if isinstance(d, dict)]}
    if block in ('etc', 'nw'):
        return {'spec': val(data.get('spec'))}
    basis = val(data.get('basis'))
    return {'version': val(data.get('version')), 'edition': val(data.get('edition')),
            'basis': basis if basis in spec.SW_BY_KEY else ''}


def clean_items(rows):
    if not isinstance(rows, list):
        raise ValidationError('구매 사양 형식이 잘못되었습니다.')
    if len(rows) > MAX_ITEMS:
        raise ValidationError(f'구매 사양은 {MAX_ITEMS}줄까지 입력할 수 있습니다.')
    out = []
    for i, r in enumerate(rows, 1):
        if not isinstance(r, dict) or r.get('block') not in spec.BLOCKS:
            raise ValidationError(f'{i}번째 줄의 구역이 잘못되었습니다.')
        it = {'block': r['block'], 'data': _clean_data(r['block'], r.get('data'))}
        for k, n in ITEM_TEXT.items():
            it[k] = str(r.get(k) or '').strip()[:n]
        q = r.get('qty')
        it['qty'] = spec.num(q)
        if q not in (None, '') and it['qty'] is None:
            raise ValidationError(f"{i}번째 줄({it['name'] or it['model'] or spec.BLOCK_LABEL[it['block']]})의 수량은 숫자로 입력해 주세요.")
        if r['block'] == 'server':
            it['kind'] = '서버'
        elif r['block'] == 'storage':
            it['kind'] = '스토리지'
        it['id'] = r.get('id') if isinstance(r.get('id'), int) else None
        out.append(it)
    return out


def save_items(case, rows):
    """화면 표 전체를 저장 (id가 있는 줄은 고치고, 새 줄은 만들고, 빠진 줄은 지움)"""
    items = clean_items(rows)
    # 구역 순서(서버 → 스토리지 → ETC → NW → License), 같은 구역은 화면 순서 그대로
    items.sort(key=lambda it: spec.BLOCKS.index(it['block']))
    with transaction.atomic():
        existing = {o.id: o for o in case.spec_items.all()}
        for order, it in enumerate(items):
            fields = {k: v for k, v in it.items() if k != 'id'}
            obj = existing.pop(it['id'], None) if it['id'] else None
            if obj is None:
                SpecItem.objects.create(case=case, order=order, **fields)
            elif obj.order != order or any(getattr(obj, k) != v for k, v in fields.items()):
                for k, v in fields.items():
                    setattr(obj, k, v)
                obj.order = order
                obj.save()
        for obj in existing.values():
            obj.delete()
        ReviewCase.objects.filter(pk=case.pk).update(updated_at=timezone.now())
    return case_items(case)


def calc_items(items):
    return spec.compute(items, spec.Master.from_db())


def import_items(case, data=None):
    """올린 엑셀(없으면 심의건에 올려 둔 엑셀)의 구매 사양을 화면 표로 옮긴다. 기존 입력은 바뀐다"""
    if data is None:
        if not case.source_excel:
            raise ValidationError('불러올 구매 사양 엑셀이 없습니다. 엑셀을 골라 주세요.')
        with case.source_excel.open('rb') as f:
            data = f.read()
    values = load_workbook(data)
    try:
        formulas = openpyxl.load_workbook(io.BytesIO(data))
    except Exception:
        formulas = None
    try:
        items, warnings = spec.read_items(values, formulas)
    except ValueError as e:
        raise ValidationError(str(e))
    if not items:
        raise ValidationError("'구매 사양' 시트에서 장비 줄을 찾지 못했습니다.")
    for it in items:
        it['id'] = None
    with transaction.atomic():
        case.spec_items.all().delete()
        saved = save_items(case, items)
        case.input_mode = 'FORM'
        case.save(update_fields=['input_mode', 'updated_at'])
    return saved, warnings


def build_spec_excel(case, path):
    """화면에서 입력한 구매 사양으로 엑셀을 만든다 (PPT 엔진이 읽는 칸 배치)"""
    items = case_items(case)
    if not items:
        raise ValidationError('구매 사양을 먼저 입력해 주세요.')
    wb = spec.build_workbook(case.title, items, spec.Master.from_db())
    wb.save(path)
    return path


def generate(case, user=None):
    """심의건의 구매 사양(화면 입력 또는 올린 엑셀)으로 PPT와 배포용 엑셀을 만들어 ReviewOutput으로 남긴다"""
    from .engine import make_ppt
    use_form = case.input_mode == 'FORM'
    if use_form and not case.spec_items.exists():
        raise ValidationError('구매 사양을 먼저 입력해 주세요.')
    if not use_form and not case.source_excel:
        raise ValidationError('먼저 구매 사양 엑셀을 올려 주세요.')
    tpl_path, _ = active_template()
    if tpl_path is None:
        raise ValidationError('PPT 템플릿이 없습니다. 템플릿(.pptx)을 먼저 올려 주세요.')

    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M')
    stem = safe_stem('_'.join(p for p in (case.year, case.line, case.product, case.title) if p))
    output = ReviewOutput(case=case, created_by=user)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        if use_form:
            src = build_spec_excel(case, tmp / f'{stem}.xlsx')
        else:
            ext = Path(case.source_name or case.source_excel.name).suffix.lower() or '.xlsx'
            src = tmp / f'{stem}{ext}'
            with case.source_excel.open('rb') as f, open(src, 'wb') as out:
                shutil.copyfileobj(f, out)
        ppt_path = tmp / f'{stem}_투자심의_{stamp}.pptx'
        try:
            _, log = make_ppt.run(src, tpl_path, ppt_path)
        except SystemExit as e:  # 시트 없음 등 엔진이 알려 주는 오류
            raise ValidationError(str(e))
        except Exception:
            output.ok = False
            output.log = traceback.format_exc()[-4000:]
            output.save()
            raise ValidationError('PPT를 만들다가 오류가 났습니다. 실행 기록을 확인해 주세요.')
        # 서버 임시 경로는 화면에 보여줄 필요가 없으므로 파일 이름만 남김
        log = [re.sub(r'저장: .*[\\/]', '저장: ', line) for line in log]
        log.insert(1, '[입력] 화면에서 입력한 구매 사양' if use_form else f'[입력] 올린 엑셀: {case.source_name}')
        output.log = '\n'.join(log)
        output.ok = not any(line.startswith('[오류]') for line in log)
        with open(ppt_path, 'rb') as f:
            output.pptx.save(ppt_path.name, File(f), save=False)
        dist = sorted(tmp.glob(f'{stem}_배포용_*.xlsx'))
        if dist:
            with open(dist[-1], 'rb') as f:
                output.xlsx.save(dist[-1].name, File(f), save=False)
        output.save()
    ReviewCase.objects.filter(pk=case.pk).update(updated_at=timezone.now())
    return output
