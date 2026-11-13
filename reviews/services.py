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
from .models import CpuSpec, MasterList, PartCode, PptTemplate, ReviewCase, ReviewOutput

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


def _sync(model, incoming, key_field='name'):
    """incoming(dict: 이름 → 값들)으로 테이블을 맞춘다. (추가, 변경, 삭제) 수를 돌려준다"""
    existing = {getattr(o, key_field): o for o in model.objects.all()}
    added = changed = 0
    for name, fields in incoming.items():
        obj = existing.pop(name, None)
        if obj is None:
            model.objects.create(**{key_field: name}, **fields)
            added += 1
        elif any(getattr(obj, f) != v for f, v in fields.items()):
            for f, v in fields.items():
                setattr(obj, f, v)
            obj.save()
            changed += 1
    removed = len(existing)
    for obj in existing.values():
        obj.delete()
    return {'added': added, 'changed': changed, 'removed': removed, 'total': len(incoming)}


def _diff(model, incoming, fields):
    existing = {o.name: o for o in model.objects.all()}
    added = sum(1 for n in incoming if n not in existing)
    changed = sum(1 for n, v in incoming.items() if n in existing and any(getattr(existing[n], f) != v[f] for f in fields))
    removed = sum(1 for n in existing if n not in incoming)
    return {'added': added, 'changed': changed, 'removed': removed, 'total': len(incoming)}


def import_master(data, dry_run=False):
    """심의 매크로 엑셀의 이름 관리자 내용을 기준정보 DB에 덮어쓴다 (엑셀에 없는 항목은 삭제)"""
    wb = load_workbook(data)
    codes, lists, cpus = read_master(wb)
    if not codes and not lists:
        raise ValidationError('이름 관리자 항목을 찾지 못했습니다. 심의 매크로 엑셀(.xlsm)이 맞는지 확인해 주세요.')
    if dry_run:
        return {
            'codes': _diff(PartCode, codes, ('key', 'cis_code')),
            'lists': _diff(MasterList, lists, ('group', 'values', 'source')),
            'cpus': _diff(CpuSpec, cpus, ('clock', 'cores')),
            'missing_cis': sorted(n for n, v in codes.items() if not re.match(r'^Q4\w{2}-\w+$', v['cis_code'].strip())),
        }
    with transaction.atomic():
        return {
            'codes': _sync(PartCode, codes),
            'lists': _sync(MasterList, lists),
            'cpus': _sync(CpuSpec, cpus),
        }


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


def _safe_stem(text):
    return re.sub(r'[\\/:*?"<>|\s]+', '_', text or '').strip('_')[:60] or 'review'


def generate(case, user=None):
    """심의건의 구매 사양 엑셀로 PPT와 배포용 엑셀을 만들어 ReviewOutput으로 남긴다"""
    from .engine import make_ppt
    if not case.source_excel:
        raise ValidationError('먼저 구매 사양 엑셀을 올려 주세요.')
    tpl_path, _ = active_template()
    if tpl_path is None:
        raise ValidationError('PPT 템플릿이 없습니다. 템플릿(.pptx)을 먼저 올려 주세요.')

    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M')
    stem = _safe_stem('_'.join(p for p in (case.year, case.line, case.product, case.title) if p))
    output = ReviewOutput(case=case, created_by=user)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
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
