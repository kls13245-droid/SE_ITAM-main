# -*- coding: utf-8 -*-
"""
투자심의 PPT 자동 생성 도구
---------------------------------------------------------------------------
기존 VBA 5종(추진내용/변경내용/HW/SW/비용)을 Python으로 옮긴 버전.

  - 엑셀(.xlsx/.xlsm)의 '구매 사양' 시트를 읽어서
  - PPT 템플릿의 표를 '헤더 모양'으로 찾아 채운 뒤
  - 새 PPT 파일로 저장합니다. (원본 템플릿은 건드리지 않음)

사용법
  1) 더블클릭(실행.bat 또는 make_ppt.exe) → 엑셀 선택 창이 뜸
     템플릿은 같은 폴더의 template.pptx → exe 안에 포함된 템플릿 순서로 자동 사용 (없으면 선택 창)
  2) 명령줄: python make_ppt.py 엑셀파일 [템플릿.pptx [출력.pptx]]
  3) exe 만들기: 빌드.bat 실행 (Python이 설치된 PC에서 1회) → dist 폴더의 make_ppt.exe 배포

필요 패키지: pip install python-pptx openpyxl
주의: 엑셀은 Excel에서 한 번 저장된 파일이어야 합니다(수식 결과값을 읽음).
---------------------------------------------------------------------------
"""
import re
import sys
import datetime
from copy import deepcopy
from pathlib import Path

import openpyxl
from pptx import Presentation
from pptx.oxml.ns import qn

# 파일 구성 (위에서부터 순서대로)
#   1. 설정            : 실행 동작을 바꾸는 상수 값
#   2. 엑셀 읽기        : Sheet(셀 읽기), CpuDB(CPU 클럭·코어 조회)
#   3. 표 데이터 만들기  : build_추진내용 / build_변경내용 / build_HW / build_SW / build_비용
#   4. PPT 표 조작      : 표 채우기, 테두리, 행 높이·열 너비 계산, 페이지 분할, 슬라이드 복제
#   5. 구성도           : SW/HW Architecture 슬라이드의 서버 박스·아이콘·VM 상자 작성
#   6. 배포용 엑셀       : .xlsm에서 매크로를 제거한 .xlsx 생성
#   7. 실행             : run()(전체 순서), main()(파일 선택 창 / 명령줄 실행)
# 단위: PPT 위치·크기는 EMU (1pt = 12700 EMU, 1cm = 360000 EMU)

# ===========================================================================
# 설정 (필요하면 여기만 수정)
# ===========================================================================
SCRIPT_VERSION = "2026-11-12 (열 밀림 보정)"  # 완료 창 첫 줄에 표시. 어떤 버전이 실행됐는지 확인용
SRC_SHEET = "구매 사양"
CPU_SHEET = "CPU 호환 모델"

# 표가 슬라이드 아래로 넘치면 같은 슬라이드를 복제해서 이어 씀 (행 높이는 글자 길이로 추정)
# 넘칠 때 글자 크기를 이 비율까지 줄여볼 수 있음 (1.0 = 줄이지 않음)
FONT_MIN = {"추진내용": 0.75, "변경내용": 0.75, "HW": 0.85, "SW": 0.9, "비용": 0.9}
# 슬라이드를 나누지 않고 무조건 한 장에 담을 표 (넘치면 경고만 표시)
ONE_PAGE_ONLY = {"추진내용", "변경내용"}
# 열 너비 자동 맞춤(엑셀 열 경계 더블클릭처럼): 내용 길이에 맞춰 넓히고 줄임. 표 전체 너비는 템플릿 그대로
# 데이터가 비어 있는 열(단가·금액 등 손으로 채우는 칸)은 템플릿 너비를 유지
AUTOFIT = {"HW", "SW", "비용"}
# 비어 있는 열(손으로 채우는 칸)의 너비: 템플릿 너비 대비 비율 (1.0 = 그대로 유지)
EMPTY_COL_SCALE = {"HW": 0.6, "SW": 0.6, "비용": 1.0}
# 헤더 문구 수정 (줄바꿈 위치 등)
HEADER_TEXT_FIX = {"비용": [("(예가테이블/메일회신)", "(예가테이블/\n메일회신)")]}
# 헤더에서 위아래 두 칸으로 나뉜 셀을 한 칸으로 병합할 열 (0부터 시작). HW의 '용도 및 / 사용 범위'
HEADER_MERGE = {"HW": [5]}
# 슬라이드 제목의 업무명을 엑셀 '업무' 값으로 바꾸는 규칙 (정규식의 n 자리를 교체, ins 자리 앞에 끼워넣기)
#   템플릿마다 업무명 표기가 달라도(DAQ, DMM25, DM25, DM ...) 제목 형태로 찾아서 바꿈. 본문 내용은 건드리지 않음
TITLE_RULES = [
    r"^\s*▣\s*(?P<n>[^\s(]+(?:\s*\([^)]*\))?)(?:\s*기능)?\s*$",                 # ▣ DAQ (설명) 기능 / ▣ DMM25
    r"^\s*■\s*(?:(?P<n>\S+)\s+)?(?P<ins>[HS]W\s*자원\s*현황)\s*$",               # ■ (DAQ) HW 자원 현황
    r"^\s*■\s*DBMS\s*구성\s*종류\s*\((?P<n>[^)]*)\)",                            # ■ DBMS 구성 종류 (DMM25)
    r"^\s*■\s*(?P<n>[A-Za-z][A-Za-z0-9_\-]*)\s*(?::.*)?$",                          # ■ DMM25 / ■ DM : 신규 서버 도입
    r"^\s*\[별첨\]\s*(?:[A-Z0-9]{2,4}\s+)?(?P<n>\S+)\s+(?:Rack\s*실장도|LAN/IP)",  # [별첨] (C1R) DM25 Rack 실장도
    r"^\s*Ⅰ\.\s*과제\s*개요\s*[–-]\s*3\.\s*(?P<n>\S+)\s*구성\s*$",              # Ⅰ. 과제 개요 – 3. DMM25 구성
]
# 위 규칙에 걸려도 업무명이 아닌 단어 (바꾸지 않음)
TITLE_STOPWORDS = {"DBMS", "HW", "SW", "NW"}
# 3페이지 체크박스처럼 좁은 칸에서 줄바뀜이 생기는 짧은 문구는 줄바꿈 없이 한 줄로
NOWRAP_TEXTS = {"신규", "변경(증설)", "변경(교체)"}
# 행 높이 계산용 줄 간격(글자 크기 대비). 작을수록 행이 촘촘해짐
LINE_SPACING = 1.2
# 표 아래 한계선: 표 밑에 있는 다른 도형(설명 문구 등) 위까지. 없으면 슬라이드 높이의 이 비율까지
BOTTOM_RATIO = 0.93

# HW 자원 현황 표: True면 사양이 같은 서버를 한 줄로 묶음. 기본은 서버별로 한 줄씩 (구성도 묶기는 ARCH_GROUP_BY_ROLE)
# 기존 VBA처럼 한 대씩 따로 쓰려면 False
HW_GROUP_SAME_SPEC = False

# 구성도(Architecture): 호스트명 끝 꼬리표(A/S 또는 번호)만 다른 서버를 같은 역할로 보고 한 박스로 묶기
#   Master-A + Master-S → Master-A/S,  UI1 + UI2 → UI1/2,  OFF → 단독
#   (A/S 또는 숫자로 끝나는 이름만 묶음. 정확한 구성은 설계자 확인 필요)
ARCH_GROUP_BY_ROLE = True

# PPT 템플릿 파일 이름. 아래 순서로 찾고, 모두 없으면 파일 선택 창을 띄움
#   1) 실행 파일(exe) 또는 make_ppt.py와 같은 폴더에 있는 이 이름의 파일
#   2) exe 빌드 시 안에 포함한 파일 (PyInstaller --add-data)
TEMPLATE_NAME = "라인명_제품_투자심의_미래로시스템_Ver0.1.pptx"  # 빌드.bat의 --add-data 파일 이름과 같아야 함

# 실행할 때 PPT와 함께 매크로 없는 배포용 엑셀(.xlsx)도 만들기
MAKE_DIST_EXCEL = True
# 배포용 엑셀에서 지울 시트 (이름이 이걸로 시작하면 삭제)
DIST_DROP_SHEET_PREFIX = ("(숨김)PPT-",)

# 본문(헤더 아래 데이터 행)을 일반체로 표시할 표. 템플릿 견본 행이 굵게 되어 있어도 굵게를 해제함
#   소계·합계 등 코드에서 bold=True로 지정한 행은 굵게 유지. 헤더 행은 템플릿 서식 그대로
BODY_PLAIN = {"비용"}

# 비용 표: 수량 0인 SW/NW/ETC 행 제외 (기존 VBA는 포함했음)
COST_SKIP_ZERO_QTY = True

# 표 테두리: 모든 칸을 이 색의 얇은 실선으로 통일 (16진수 RGB, C8C8C8 = 연회색). None이면 템플릿 테두리 그대로
TABLE_BORDER_RGB = "C8C8C8"
TABLE_BORDER_PT = 0.75

# 비용 표 맨 끝에 붙는 고정 행
COST_TAIL_ROWS = ["IT기타 (H/W,SW Install)", "비IT기타 (Recipe Setup)", "인건비", "합계"]


# 공백·전각공백·세로탭을 모두 제거한 문자열 반환. 헤더 문구 비교용
def _norm(s):
    return re.sub(r"[\s\u3000\x0b]", "", s or "")


# 템플릿에서 표를 찾는 기준: 첫 행(헤더) 텍스트. 슬라이드 번호는 필요 없음
# 표 첫 행의 각 칸 텍스트를 _norm 처리한 목록으로 반환
def _hdr(tbl):
    return [_norm(tbl.cell(0, c).text) for c in range(len(tbl.columns))]


# 표 종류별 판별 조건: 첫 행(헤더)의 칸 수와 특정 칸 문구로 템플릿 안의 표를 식별
#   키 = 표 이름, 값 = 헤더 목록을 받아 True/False를 돌려주는 함수
SIGNATURES = {
    "추진내용": lambda h: len(h) == 3 and h[0] == "항목" and h[2] == "내용",
    "변경내용": lambda h: len(h) == 4 and h[0] == "업무" and h[1].startswith("기준서버"),
    "HW": lambda h: len(h) == 10 and h[0] == "구분" and h[3].startswith("Host"),
    "SW": lambda h: len(h) == 12 and h[0] == "구분" and h[3] == "버전",
    "비용": lambda h: len(h) == 12 and h[1] == "항목" and h[2] == "제조사명",
}


# ===========================================================================
# 엑셀 읽기
# ===========================================================================
def fmt_number(v, numfmt):
    """엑셀 .Text 처럼 셀 서식을 반영한 문자열로 변환 (예: 0.0"TB" → 6.4TB)"""
    # 논리값은 엑셀 표기와 같은 TRUE/FALSE
    if isinstance(v, bool):
        return str(v).upper()
    # 숫자가 아니면 문자열 그대로 반환
    if not isinstance(v, (int, float)):
        return str(v)
    # 표시 형식의 첫 번째 구역(양수용)만 사용
    f = (numfmt or "General").split(";")[0]
    if f == "General":
        if float(v).is_integer():
            return str(int(v))
        return ("%.10g" % v)
    # 따옴표로 감싼 문자(예: "GHz", "TB")는 숫자 뒤에 붙일 단위로 따로 보관
    literals = re.findall(r'"([^"]*)"', f)
    core = re.sub(r'"[^"]*"', "", f).replace("\\", "")
    pct = "%" in core
    if pct:
        v = v * 100
    # 숫자 자리 패턴에서 소수 자릿수와 천 단위 쉼표 사용 여부를 읽음
    m = re.search(r"[0#,]+(\.([0#]+))?", core)
    if not m:
        return str(v)
    dec = len(m.group(2) or "")
    comma = "," in m.group(0)
    s = f"{v:,.{dec}f}" if comma else f"{v:.{dec}f}"
    # "#" 형식에서 값이 0이면 엑셀처럼 빈 문자열로 표시
    if "#" in m.group(0) and not m.group(0).startswith("0") and s in ("0", "0.0"):
        s = ""
    suffix = "".join(literals)
    return s + ("%" if pct else "") + suffix


class Sheet:
    """VBA의 Cells(r, c).Value / .Text 를 흉내내는 래퍼 (1부터 시작하는 행/열)"""

    def __init__(self, ws):
        self.ws = ws
        self.max_row = ws.max_row
        # 열 밀림 보정: 원래 양식은 A열=업무, B열=유형. 앞쪽에 빈 열이 끼어 있으면 '유형' 헤더 위치로 칸 수를 계산해 그만큼 건너뜀
        self.off = 0
        for c in range(1, min(ws.max_column, 10) + 1):
            if str(ws.cell(1, c).value or "").strip() == "유형":
                self.off = max(0, c - 2)
                break
        self.max_col = ws.max_column - self.off

    # 셀 값(엑셀 Value). 오류값은 빈 문자열로 바꿔 반환
    def val(self, r, c):
        v = self.ws.cell(r, c + self.off).value
        if isinstance(v, str) and v.startswith("#") and v.endswith(("!", "?", "A")):
            return ""  # #REF!, #NAME?, #N/A 등 오류값은 빈칸 처리
        return v

    # 셀 표시 문자열(엑셀 Text). 셀의 표시 형식을 적용하고 앞뒤 공백 제거
    def txt(self, r, c):
        v = self.val(r, c)
        if v is None or v == "":
            return ""
        return fmt_number(v, self.ws.cell(r, c + self.off).number_format).strip()

    def s(self, r, c):
        """줄바꿈 제거한 텍스트 (VBA Replace(vbLf, ""))"""
        return self.txt(r, c).replace("\r", "").replace("\n", "")

    # 행 숨김 여부
    def hidden(self, r):
        return bool(self.ws.row_dimensions[r].hidden)

    # 셀 값을 숫자로 변환. 숫자로 시작하는 문자열(예: '2EA')은 앞의 숫자만 사용, 실패 시 0.0
    def num(self, r, c):
        v = self.val(r, c)
        try:
            return float(v)
        except (TypeError, ValueError):
            m = re.match(r"\s*(-?\d+(\.\d+)?)", str(v or ""))
            return float(m.group(1)) if m else 0.0

    # 해당 열에서 값이 있는 마지막 행 번호 (엑셀 End(xlUp)과 같은 역할)
    def last_row(self, col):
        for r in range(self.max_row, 0, -1):
            if self.val(r, col) not in (None, ""):
                return r
        return 1


# 수량 표기: 정수면 소수점 없이, 아니면 불필요한 0 없이 표시
def qty_str(q):
    return str(int(q)) if float(q).is_integer() else ("%g" % q)


class CpuDB:
    """CPU 호환 모델 시트 기반 클럭/코어 조회 (VBA UDF GetCPUVersion/GetCPUCoreCount 대체)"""

    def __init__(self, wb):
        # by_full: 풀네임(대문자) → (클럭, 코어), by_model: 모델 번호(예: 6511P) → (클럭, 코어)
        self.by_full, self.by_model = {}, {}
        if CPU_SHEET not in wb.sheetnames:
            return
        ws = wb[CPU_SHEET]
        # 2행부터 A열 풀네임, B열 클럭, C열 코어 수를 읽음. 같은 키가 있으면 먼저 나온 값 유지
        for row in ws.iter_rows(min_row=2, values_only=True):
            name = str(row[0] or "").strip()
            if not name:
                continue
            spec = (row[1], row[2])
            self.by_full.setdefault(name.upper(), spec)
            m = self.model(name)
            if m:
                self.by_model.setdefault(m, spec)

    @staticmethod
    # 문자열에서 '숫자 4자리 + 영문자' 패턴(예: 6511P, 3508U)을 모델 번호로 추출. VBA ExtractCPUModel과 같은 규칙
    def model(txt):
        m = re.search(r"\d{4}[A-Z]*", (txt or "").upper())
        return m.group(0) if m else ""

    # 풀네임으로 먼저 찾고, 없으면 모델 번호로 찾음. 둘 다 없으면 None
    def lookup(self, cpu):
        cpu = (cpu or "").strip()
        if not cpu:
            return None
        return self.by_full.get(cpu.upper()) or self.by_model.get(self.model(cpu))


# 값이 비어 있으면 '-', 있으면 '일반' 서식 문자열로 변환
def _g(v):
    return fmt_number(v, "General") if v not in (None, "") else "-"


# r행 CPU(J열)의 (클럭, 코어 수) 문자열 반환
#   CPU 호환 모델 시트에서 찾으면 그 값을, 못 찾으면 K열(클럭)·L열(코어)에 들어 있는 값을 사용
def cpu_speed_core(sh, cpu_db, r, col_cpu=10, col_speed=11, col_core=12):
    """CPU 이름이 있으면 CPU 호환 모델 시트에서 다시 조회 (매크로 차단으로 K·L열이 #NAME? 인 파일에도 적용됨)"""
    spec = cpu_db.lookup(sh.txt(r, col_cpu))
    if spec:
        return _g(spec[0]), _g(spec[1])
    return sh.s(r, col_speed) or "-", sh.s(r, col_core) or "-"


# 반환: (h1, h2) - 열 번호 → 1행 대분류 / 2행 소분류 헤더 문자열
def header_maps(sh):
    """1행(병합된 대분류는 왼쪽 값으로 채움)과 2행 헤더"""
    h1, h2, last = {}, {}, ""
    for c in range(1, sh.max_col + 1):
        v = str(sh.val(1, c) or "").strip()
        if v:
            last = v
        h1[c] = last
        h2[c] = str(sh.val(2, c) or "").strip()
    return h1, h2


# ===========================================================================
# 표 데이터 만들기 (기존 VBA 로직 이식)
# ===========================================================================
# 표 한 행을 나타내는 dict 생성
#   cells: 칸별 문자열, group: 세로 병합 기준값, bold: 굵게 여부, hspan: (시작 열, 끝 열) 가로 병합 범위
def R(cells, group=None, bold=False, hspan=None):
    return {"cells": [str(x) if x is not None else "" for x in cells],
            "group": group, "bold": bold, "hspan": hspan}


# [추진내용 표] H/W 종류별 수량 합계와 S/W 제품별 수량 합계를 만듦
#   반환: (블록 목록, 옵션). 블록은 한 페이지에 함께 있어야 하는 행 묶음이며, 여기서는 행 하나가 블록 하나
def build_추진내용(sh):
    # H/W 집계 순서와 항목 이름 (값 = 수량 합계)
    hw = {"Server": 0.0, "Storage": 0.0, "SAN Switch": 0.0, "Switch": 0.0}
    sw, task_name = {}, ""
    for r in range(3, sh.last_row(3) + 1):
        if sh.hidden(r):
            continue
        a, b, c = (str(sh.val(r, x) or "").strip() for x in (1, 2, 3))
        # 소계·헤더·구분 행은 제외
        if "소계" in a or "소계" in b or b == "유형" or c == "장비명" or a.upper() in ("H/W", "S/W"):
            continue
        t_type, t_name = b.upper().replace(" ", ""), c.upper()
        manuf, raw_ed = str(sh.val(r, 5) or "").upper().strip(), sh.txt(r, 9)
        qty = sh.num(r, 7)
        if qty <= 0:
            continue
        # A열에 처음 나오는 업무명을 S/W 첫 줄 제목으로 사용
        if a and a not in ("업무", "ETC") and a.upper() != "LICENSE" and not task_name:
            task_name = a
        # 유형(B열)·장비명(C열) 문구로 서버/스토리지/스위치/소프트웨어를 구분해 수량을 더함
        is_switch = any(k in t_type or k in t_name for k in ("스위치", "SWITCH")) or t_type == "SAN"
        if t_type in ("서버", "SERVER"):
            hw["Server"] += qty
        elif t_type in ("스토리지", "STORAGE"):
            hw["Storage"] += qty
        elif is_switch:
            hw["SAN Switch" if ("SAN" in t_type or "SAN" in t_name) else "Switch"] += qty
        elif (t_type in ("OS", "VSPHERE", "DBMS", "ORACLE", "HYPERVISOR", "HA", "SW", "LICENSE")
              or "ROSEHA" in t_type or "ROSEHA" in t_name.replace(" ", "")
              or "VMWARE" in manuf or "ROSE" in manuf):
            # S/W 이름 = F열(모델명), 없으면 C열. Windows가 아니면 I열(에디션)을 뒤에 붙임
            name = (sh.txt(r, 6) or c).replace("_", " ").strip()
            if "WINDOWS" not in name.upper() and "MICROSOFT" not in manuf and raw_ed:
                name = f"{name} {raw_ed}"
            if name:
                sw[name] = sw.get(name, 0) + qty

    rows = [R(["H/W", k, qty_str(v) + "ea"], group="H/W") for k, v in hw.items() if v > 0]
    sw_rows = []
    if task_name:
        sw_rows.append(R(["S/W", task_name, ""], group="S/W"))
    # Oracle 제품은 S/W 목록 맨 뒤에 배치
    names = [n for n in sw if "ORACLE" not in n.upper()] + [n for n in sw if "ORACLE" in n.upper()]
    sw_rows += [R(["S/W", n, qty_str(sw[n]) + "ea"], group="S/W") for n in names]
    # vmerge: 0번 열(H/W, S/W 구분)을 group 값이 같은 행끼리 세로 병합
    return [[x] for x in rows + sw_rows], {"vmerge": [(0, "group")]}


# [변경내용 표] 유형(B열)이 '서버'인 행마다 (업무, 빈칸, 호스트명, 빈칸) 한 줄
#   A열이 비어 있으면 위쪽 업무명을 이어받음
def build_변경내용(sh):
    rows, task = [], ""
    for r in range(3, sh.last_row(3) + 1):
        a = str(sh.val(r, 1) or "").strip()
        if a:
            task = a
        if str(sh.val(r, 2) or "").strip() == "서버":
            rows.append(R([task, "", sh.s(r, 3), ""], group=task))
    return [[x] for x in rows], {"vmerge": [(0, "group")]}


def server_extra_rows(sh, r, cols):
    """서버 r행 바로 아래에서 유형(B열)이 비어 있고 부품 칸(cols)에 값이 있는 행 번호 목록 (같은 서버의 추가 부품)"""
    rows, nr, last = [], r + 1, sh.last_row(3)
    while nr <= last and not str(sh.val(nr, 2) or "").strip():
        if not sh.hidden(nr):
            if not any(sh.txt(nr, c) not in ("", "-", "0") for c in cols):
                break
            rows.append(nr)
        nr += 1
    return rows


# 반환: 장비 dict 목록. kind = server / storage / etc
#   group이 None이면 HW_GROUP_SAME_SPEC 설정을, 값이 있으면 그 값을 '같은 사양 묶기' 여부로 사용
def hw_items(sh, cpu_db, group=None):
    """구매 사양의 H/W 장비 목록 (HW 표·구성도 공용)"""
    h1, h2 = header_maps(sh)
    # 2행 헤더가 있는 마지막 열 (없으면 40열)
    last_col = max([c for c in h2 if h2[c]] or [40])
    out, r, last = [], 3, sh.last_row(3)
    while r <= last:
        jump = 0
        if sh.hidden(r):
            r += 1
            continue
        a = str(sh.val(r, 1) or "").strip()
        t_type = str(sh.val(r, 2) or "").strip().upper().replace(" ", "")
        t_name = str(sh.val(r, 3) or "").strip()
        qty = sh.num(r, 7)
        # S/W 구간이 시작되면 H/W 목록 읽기를 종료
        if a.upper() == "LICENSE" or t_type in ("OS", "HYPERVISOR", "HA"):
            break
        if (not t_type or "소계" in t_type or "소계" in t_name or t_type == "유형"
                or a.upper() in ("H/W", "S/W") or qty <= 0):
            r += 1
            continue

        # 서버: CPU·메모리·디스크 등 사양 문자열 조립 / 스토리지: 디스크 줄 목록 / 그 외: 첫 번째 사양 칸
        extra = {"kind": "etc"}
        if "서버" in t_type or "SERVER" in t_type:
            speed, core = cpu_speed_core(sh, cpu_db, r)
            extra = {"kind": "server", "os": sh.s(r, 9), "speed": speed, "core": core,
                     "cpu_qty": sh.s(r, 13), "mem": sh.s(r, 14)}
            parts = []
            if speed != "-" and core != "-":
                parts.append(f"{speed}GHz {core}core * {sh.s(r, 13)}")
            # O열(15)부터 2행 헤더가 '구매 사양/종류/제품'인 열의 값을 사양으로 사용 (HBA 열 제외)
            #   바로 왼쪽 열 헤더가 TYPE이면 그 값을 앞에 붙이고, 바로 오른쪽 열 헤더가 수량이면 ' * 수량'을 붙임
            #   아래 행(유형 칸 빈칸)에 이어서 적힌 추가 부품(디스크·NIC·GPU 등)도 같은 서버 사양에 붙임
            spec_cols = [c for c in range(15, last_col + 1)
                         if h1.get(c, "").upper() != "HBA" and h2.get(c) in ("구매 사양", "종류", "제품")]
            for rr in [r] + server_extra_rows(sh, r, spec_cols):
                for c in spec_cols:
                    spec = sh.txt(rr, c)
                    if not spec or spec == "-":
                        continue
                    if h2.get(c - 1, "").upper() == "TYPE":
                        t = sh.txt(rr, c - 1)
                        if t and t != "-":
                            spec = f"{t} {spec}"
                    q = sh.txt(rr, c + 1) if h2.get(c + 1) == "수량" else ""
                    parts.append(f"{spec} * {q}" if q not in ("", "0", "-") else spec)
            spec_str = ", ".join(parts)

        elif ("스토리지" in t_type or "STORAGE" in t_type) and "SWITCH" not in t_type and "스위치" not in t_type:
            def disk_line(rr):
                s = f"{sh.s(rr, 10)} * {sh.s(rr, 11)}"
                usable = sh.txt(rr, 13) or sh.txt(rr, 14)
                return s + (f", Usable {usable}" if usable else "")
            # B열이 비어 있고 J열에 값이 있는 아래 행들은 같은 스토리지의 추가 디스크로 보고 이어서 읽음
            #   jump: 다음 반복에서 건너뛸 마지막 행 번호
            lines, nr = [disk_line(r)], r + 1
            while not str(sh.val(nr, 2) or "").strip() and str(sh.val(nr, 10) or "").strip():
                lines.append(disk_line(nr))
                nr += 1
            spec_str, jump = "\n".join(lines), nr - 1
            extra = {"kind": "storage", "usable": sh.txt(r, 14) or sh.txt(r, 13)}
        else:
            # H~Z열에서 두 글자 이상인 첫 번째 값을 사양으로 사용
            spec_str = next((sh.s(r, c) for c in range(8, 27) if len(sh.s(r, c)) > 1), "") or sh.s(r, 9)

        out.append(dict(extra, manuf=sh.s(r, 5), model=sh.s(r, 6), host=sh.s(r, 3),
                        type=str(sh.val(r, 2) or "").strip(), spec=spec_str, use="", qty=qty))
        r = (jump if jump else r) + 1

    # 같은 사양 묶기: (제조사, 모델, 사양, 용도, OS)가 같으면 호스트명을 '/'로 잇고 수량을 더함
    if HW_GROUP_SAME_SPEC if group is None else group:
        merged = {}
        for o in out:
            k = (o["manuf"], o["model"], o["spec"], o["use"], o.get("os", ""))
            if k in merged:
                merged[k]["host"] += "/" + o["host"]
                merged[k]["qty"] += o["qty"]
            else:
                merged[k] = dict(o)
        out = list(merged.values())
    return out


# [HW 자원 현황 표] 장비 한 대(또는 묶음)당 한 줄
def build_HW(sh, cpu_db):
    out = hw_items(sh, cpu_db)
    rows = [R(["신규", o["manuf"], o["model"], o["host"], o["spec"], o["use"],
               "-", "-", qty_str(o["qty"]), qty_str(o["qty"])]) for o in out]
    return [[x] for x in rows], {}


# [SW 자원 현황 표] 업무(A열)·유형(B열)이 소프트웨어인 행 중 수량이 0보다 큰 행마다 한 줄
def build_SW(sh):
    rows = []
    for r in range(3, sh.last_row(3) + 1):
        if sh.hidden(r):
            continue
        t_task = str(sh.val(r, 1) or "").strip().upper()
        t_type = str(sh.val(r, 2) or "").strip().upper().replace(" ", "")
        t_name = str(sh.val(r, 3) or "").strip()
        qty = sh.num(r, 7)
        if not t_type or "소계" in t_type or "소계" in t_name or t_type == "유형":
            continue
        is_sw = (t_task in ("LICENSE", "S/W", "SW")
                 or t_type in ("OS", "HYPERVISOR", "HA", "DBMS", "SW", "LICENSE")
                 or "VSPHERE" in t_type or "ORACLE" in t_type)
        if is_sw and qty > 0:
            rows.append(R(["신규", sh.s(r, 5), sh.s(r, 6), sh.s(r, 9), sh.s(r, 10), sh.s(r, 11),
                           sh.s(r, 12), sh.s(r, 4), "-", "N/A", qty_str(qty), qty_str(qty)]))
    return [[x] for x in rows], {}


# [비용 표] 서버·스토리지는 부품별(Mainboard/CPU/Memory/Disk/GPU/Service)로 여러 줄,
#   NW·ETC·SW는 한 줄씩 만들고 구분(HW/NW/SW)이 바뀔 때마다 소계 행, 마지막에 COST_TAIL_ROWS 행을 추가
def build_비용(sh, cpu_db):
    h1, h2 = header_maps(sh)
    # CIS CODE 열 동적 탐색
    cis, first_cis = {}, 9999
    # 1·2행 헤더를 이어 붙인 문자열(공백·-·/ 제거, 대문자)에 아래 문구가 들어 있으면 해당 CIS CODE 열로 기록
    keys = [("SERVERCIS", "svr"), ("CPUCIS", "cpu"), ("RAMCIS", "ram"), ("MEMORYCIS", "ram"),
            ("DISK1CIS", "disk1"), ("DISK2CIS", "disk2"), ("GPUCIS", "gpu"), ("워런티CIS", "war"),
            ("WARRANTYCIS", "war"), ("STORAGECIS", "sto"), ("ETCCIS", "etc"), ("SWCIS", "sw"),
            ("소프트웨어CIS", "sw")]
    for c in range(15, sh.max_col + 1):
        k = re.sub(r"[\s\-/]", "", f"{sh.txt(1, c)}{sh.txt(2, c)}").upper()
        for pat, name in keys:
            if pat in k and name not in cis:
                cis[name] = c
                first_cis = min(first_cis, c)
    if "disk1" not in cis:
        for c in range(15, sh.max_col + 1):
            if "DISKCIS" in re.sub(r"[\s\-/]", "", f"{sh.txt(1, c)}{sh.txt(2, c)}").upper():
                cis["disk1"] = c
                break
    # SW CIS 열이 없으면 ETC CIS 바로 오른쪽 열을 사용
    if "sw" not in cis and "etc" in cis:
        cis["sw"] = cis["etc"] + 1
    if first_cis == 9999:
        first_cis = 30

    # r행의 CIS CODE 값 (해당 열이 없으면 빈 문자열)
    def code(r, name):
        return sh.txt(r, cis[name]) if name in cis else ""

    # 비용 표 한 줄(12칸) 생성. c9(CIS 값)이 '표준/비표준' 또는 두 자리 이하 숫자면 10번째 칸, 그 외는 9번째 칸에 넣음
    def item(cat, eq, manuf, prod, spec, qty, c9):
        cells = [cat, eq, manuf, prod, spec, qty, "", "", "", "", "", ""]
        if c9 and c9 != "0":
            if c9 in ("표준", "비표준") or (c9.isdigit() and len(c9) <= 2):
                cells[9] = c9
            else:
                cells[8] = c9
        return cells

    # gid: 장비 하나에서 나온 여러 줄을 같은 그룹으로 묶는 번호 (세로 병합·페이지 분할 단위)
    blocks, prev_cat, cur_task, gid = [], "", "", 0
    r, last = 3, sh.last_row(3)
    while r <= last:
        jump = 0
        if sh.hidden(r):
            r += 1
            continue
        va, vb, vc = (str(sh.val(r, x) or "").strip() for x in (1, 2, 3))
        if not vb or "소계" in vb or "업무" in va or "유형" in vb:
            r += 1
            continue
        if va:
            cur_task = va.upper()
        if vb.upper() in ("OS", "소프트웨어"):
            cur_task = "SW"
        t_task, t_type = cur_task, vb.upper().replace(" ", "")
        eq = vb if vc in ("", "-") else vc
        manuf, model = sh.s(r, 5), sh.s(r, 6)
        # 구분 결정: 서버·스토리지·ETC = HW, 업무가 NW = NW, 나머지 = SW
        if "서버" in t_type or "스토리지" in t_type or t_task == "ETC":
            cat = "HW"
        elif t_task == "NW":
            cat = "NW"
        else:
            cat = "SW"

        buf = []
        if "서버" in t_type or "SERVER" in t_type:
            buf.append(item("HW", eq, manuf, f"{model} - Mainboard", model, "1", code(r, "svr")))
            speed, core = cpu_speed_core(sh, cpu_db, r)
            buf.append(item("HW", eq, manuf, f"{model} - CPU",
                            f"{sh.txt(r, 10)} ({core}Core {speed}Ghz)" if sh.txt(r, 10) else "-",
                            sh.txt(r, 13), code(r, "cpu")))
            # O열부터 첫 CIS 열 앞까지 부품 사양 열을 읽어 1행 대분류(MEMORY/DISK/GPU)에 따라 줄 추가
            #   행마다 두 번째 디스크 열은 DISK2 CIS, 나머지는 DISK1 CIS 사용
            #   아래 행(유형 칸 빈칸)에 이어서 적힌 추가 부품도 같은 서버의 줄로 추가
            part_cols = [c for c in range(15, first_cis)
                         if h1.get(c, "").upper() != "HBA" and h2.get(c) in ("구매 사양", "종류", "제품")]
            extra_rows = server_extra_rows(sh, r, part_cols)
            for rr in [r] + extra_rows:
                disk_idx = 0
                for c in part_cols:
                    g = h1.get(c, "").upper()
                    if "DISK" in g:
                        disk_idx += 1
                    spec = sh.txt(rr, c)
                    if not spec or spec == "-":
                        continue
                    if h2.get(c - 1, "").upper() == "TYPE":
                        t = sh.txt(rr, c - 1)
                        if t and t != "-":
                            spec = f"{t} {spec}"
                    q = sh.txt(rr, c + 1) or "1"
                    if "MEMORY" in g:
                        buf.append(item("HW", eq, manuf, f"{model} - Memory", spec, q, code(rr, "ram")))
                    elif "DISK" in g:
                        buf.append(item("HW", eq, manuf, f"{model} - Disk", spec, q,
                                        code(rr, "disk2" if disk_idx == 2 else "disk1")))
                    elif "GPU" in g:
                        buf.append(item("HW", eq, manuf, f"{model} - GPU", f"NVIDIA {spec}", q, code(rr, "gpu")))
            if extra_rows:
                jump = extra_rows[-1]
            buf.append(item("HW", eq, manuf, f"{model} - Service", "WARRANTY 5yr", "1", code(r, "war")))

        elif ("스토리지" in t_type or "STORAGE" in t_type) and "SWITCH" not in t_type:
            buf.append(item("HW", eq, manuf, "Controller", model, "1", code(r, "sto")))
            nr = r
            while nr == r or (not str(sh.val(nr, 2) or "").strip() and sh.txt(nr, 10)):
                buf.append(item("HW", eq, manuf, "Disk", f"{sh.txt(nr, 8)} {sh.txt(nr, 10)}".strip(),
                                sh.txt(nr, 11), code(nr, "disk1")))
                nr += 1
            buf.append(item("HW", eq, manuf, "Service", "WARRANTY 5yr", "1", code(r, "war")))
            if nr > r + 1:
                jump = nr - 1

        elif t_task in ("ETC", "NW"):
            q = sh.num(r, 7)
            if not (COST_SKIP_ZERO_QTY and q <= 0):
                buf.append(item("HW" if t_task == "ETC" else "NW", eq, manuf, model, sh.s(r, 9),
                                qty_str(q), code(r, "etc")))
        else:
            q = sh.num(r, 7)
            if not (COST_SKIP_ZERO_QTY and q <= 0):
                buf.append(item("SW", eq, manuf, model, sh.s(r, 4), qty_str(q), code(r, "sw")))

        # 구분이 바뀌면 이전 구분의 소계 행을 먼저 넣고, 현재 장비의 줄 묶음을 한 블록으로 추가
        if buf:
            if prev_cat and prev_cat != cat:
                blocks.append([R([f"{prev_cat} 소계"], bold=True, hspan=(0, 6))])
            gid += 1
            blocks.append([R(x, group=gid) for x in buf])
            prev_cat = cat
        r = (jump if jump else r) + 1

    if prev_cat:
        blocks.append([R([f"{prev_cat} 소계"], bold=True, hspan=(0, 6))])
    for t in COST_TAIL_ROWS:
        blocks.append([R([t], bold=True, hspan=(0, 6))])
    # vmerge: 0번 열은 같은 값끼리, 1·2번 열(장비명·제조사)은 같은 장비 그룹끼리 세로 병합
    return blocks, {"vmerge": [(0, "value"), (1, "group"), (2, "group")]}


# ===========================================================================
# PPT 표 조작
# ===========================================================================
# 표의 헤더 행 수 계산: 1행에서 시작해 세로 병합으로 아래 행까지 이어진 범위를 포함
def header_row_count(tbl):
    n, changed = 1, True
    while changed:
        changed = False
        for r in range(n):
            for c in range(len(tbl.columns)):
                cell = tbl.cell(r, c)
                if cell.is_merge_origin and r + cell.span_height > n:
                    n, changed = r + cell.span_height, True
    return n


def _style_of(tc):
    """셀의 첫 문단 pPr, 첫 run rPr 복사"""
    p = tc.find(qn("a:txBody") + "/" + qn("a:p"))
    ppr = rpr = None
    if p is not None:
        ppr = p.find(qn("a:pPr"))
        rpr = p.find(qn("a:r") + "/" + qn("a:rPr"))
        if rpr is None:
            rpr = p.find(qn("a:endParaRPr"))
    return (deepcopy(ppr) if ppr is not None else None,
            deepcopy(rpr) if rpr is not None else None)


# 표 칸(a:tc)의 텍스트를 교체. 줄바꿈(\n)마다 문단을 나누고 style(pPr, rPr)을 각 문단에 적용
def _set_tc_text(tc, text, style, bold=False):
    ppr, rpr = style
    body = tc.find(qn("a:txBody"))
    for p in body.findall(qn("a:p")):
        body.remove(p)
    for line in (text.split("\n") if text else [""]):
        p = body.makeelement(qn("a:p"), {})
        if ppr is not None:
            p.append(deepcopy(ppr))
        if line:
            run = p.makeelement(qn("a:r"), {})
            rp = deepcopy(rpr) if rpr is not None else run.makeelement(qn("a:rPr"), {"lang": "ko-KR"})
            rp.tag = qn("a:rPr")
            if bold:
                rp.set("b", "1")
            run.append(rp)
            t = run.makeelement(qn("a:t"), {})
            t.text = line
            run.append(t)
            p.append(run)
        if rpr is not None:
            end = deepcopy(rpr)
            end.tag = qn("a:endParaRPr")
            p.append(end)
        body.append(p)


# 템플릿 표의 헤더는 그대로 두고, 데이터 행을 모두 지운 뒤 rows 내용으로 다시 만듦
#   첫 데이터 행을 견본으로 복사해 칸 서식(글꼴·정렬·여백)을 유지
#   heights: 행 높이 목록(EMU), font_scale: 글자 크기 배율, opts['vmerge']: 세로 병합할 열과 기준
def fill_table(shape, rows, opts, heights=None, font_scale=1.0):
    tbl = shape.table
    tbl_el = tbl._tbl
    trs = tbl_el.findall(qn("a:tr"))
    hr = header_row_count(tbl)
    # 견본 행: 헤더 바로 아래 행 (없으면 마지막 행). 견본의 병합 속성은 제거
    tmpl = deepcopy(trs[hr] if len(trs) > hr else trs[-1])
    for tc in tmpl.findall(qn("a:tc")):
        for att in ("rowSpan", "gridSpan", "hMerge", "vMerge"):
            if att in tc.attrib:
                del tc.attrib[att]
    styles = [_style_of(tc) for tc in tmpl.findall(qn("a:tc"))]
    # 글자 서식(rPr)이 없는 칸은 다른 칸의 글자 서식을 사용
    fallback = next((s for s in styles if s[1] is not None), (None, None))
    styles = [s if s[1] is not None else (s[0], fallback[1]) for s in styles]
    if opts.get("body_plain"):  # 본문 글자 서식에서 굵게(b) 해제
        styles = [(pp, deepcopy(rp)) for pp, rp in styles]
        for _, rp in styles:
            if rp is not None:
                rp.set("b", "0")

    for tr in trs[hr:]:
        tbl_el.remove(tr)

    if font_scale < 1.0:
        styles = [(pp, _scaled(rp, font_scale)) for pp, rp in styles]
    for i, row in enumerate(rows):
        tr = deepcopy(tmpl)
        if heights:
            tr.set("h", str(int(heights[i])))
        tbl_el.append(tr)
        tcs = tr.findall(qn("a:tc"))
        for i, tc in enumerate(tcs):
            txt = row["cells"][i] if i < len(row["cells"]) else ""
            _set_tc_text(tc, txt, styles[i], bold=row["bold"])

    # 가로 병합: hspan 범위의 칸을 비운 뒤 합침 (소계·합계 행)
    # 세로 병합: 기준값(group 또는 칸 값)이 연속으로 같은 행들을 합침
    # 병합
    ncol = len(tbl.columns)
    for i, row in enumerate(rows):
        if row["hspan"]:
            c1, c2 = row["hspan"]
            for k in range(c1 + 1, min(c2, ncol - 1) + 1):
                _set_tc_text(tbl.cell(hr + i, k)._tc, "", styles[k])
            tbl.cell(hr + i, c1).merge(tbl.cell(hr + i, min(c2, ncol - 1)))
    for col, mode in opts.get("vmerge", []):
        start = 0
        for i in range(1, len(rows) + 1):
            def key(k):
                rr = rows[k]
                if rr["hspan"]:
                    return None
                return rr["group"] if mode == "group" else rr["cells"][col]
            if i == len(rows) or key(i) != key(start) or key(start) in (None, ""):
                if i - 1 > start and key(start) not in (None, ""):
                    for k in range(start + 1, i):  # 병합 전 아래 칸 비우기 (python-pptx는 텍스트를 합침)
                        _set_tc_text(tbl.cell(hr + k, col)._tc, "", styles[col])
                    tbl.cell(hr + start, col).merge(tbl.cell(hr + i - 1, col))
                start = i

    # 표 도형 높이 = 모든 행 높이의 합
    shape.height = sum(int(tr.get("h")) for tr in tbl_el.findall(qn("a:tr")))
    set_table_border(tbl, TABLE_BORDER_RGB, TABLE_BORDER_PT)


# 테두리 두께 단위: 1pt = 12700 EMU. 칸마다 lnL(왼)·lnR(오른)·lnT(위)·lnB(아래)를 새로 만들어 넣음
def set_table_border(tbl, rgb, pt):
    """표의 모든 칸(헤더 포함) 상하좌우 테두리를 같은 색·두께의 실선으로 설정"""
    if not rgb:
        return
    w = str(int(pt * 12700))
    for tr in tbl._tbl.findall(qn("a:tr")):
        for tc in tr.findall(qn("a:tc")):
            pr = tc.find(qn("a:tcPr"))
            if pr is None:
                pr = tc.makeelement(qn("a:tcPr"), {})
                body = tc.find(qn("a:txBody"))
                if body is not None:
                    body.addnext(pr)
                else:
                    tc.insert(0, pr)
            for side in ("lnL", "lnR", "lnT", "lnB"):
                old = pr.find(qn("a:" + side))
                if old is not None:
                    pr.remove(old)
            for i, side in enumerate(("lnL", "lnR", "lnT", "lnB")):  # tcPr 안에서 이 순서로 맨 앞에 와야 함
                ln = pr.makeelement(qn("a:" + side), {"w": w, "cap": "flat", "cmpd": "sng", "algn": "ctr"})
                fill = ln.makeelement(qn("a:solidFill"), {})
                fill.append(fill.makeelement(qn("a:srgbClr"), {"val": rgb}))
                ln.append(fill)
                ln.append(ln.makeelement(qn("a:prstDash"), {"val": "solid"}))
                ln.append(ln.makeelement(qn("a:round"), {}))
                ln.append(ln.makeelement(qn("a:headEnd"), {"type": "none", "w": "med", "len": "med"}))
                ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "none", "w": "med", "len": "med"}))
                pr.insert(i, ln)


# 글자 서식(rPr)의 크기(sz, 1/100pt)를 f배로 줄인 복사본 반환. 최소 6pt, 0.5pt 단위로 내림
def _scaled(rpr, f):
    if rpr is None:
        return None
    rp = deepcopy(rpr)
    if rp.get("sz"):
        rp.set("sz", str(max(600, int(int(rp.get("sz")) * f / 50) * 50)))
    return rp


def _text_em(s):
    """글자 폭 대략치(em 단위): 한글/전각 1.0, 영문·숫자 0.55"""
    return sum(1.0 if ord(ch) > 0x2E80 else (0.62 if ch.isupper() else 0.55) for ch in s)


# 표가 들어갈 수 있는 세로 공간과 칸별 글꼴·여백을 계산해, 행 높이와 페이지 분할에 사용
class Geometry:
    """템플릿 표의 크기 정보 + 행 높이 추정"""

    def __init__(self, slide, shape, slide_h):
        tbl = shape.table
        trs = tbl._tbl.findall(qn("a:tr"))
        self.hr = header_row_count(tbl)
        self.col_w = [c.width for c in tbl.columns]
        self.head_h = sum(int(tr.get("h")) for tr in trs[:self.hr])
        self.row_h = int(trs[self.hr].get("h")) if len(trs) > self.hr else int(trs[-1].get("h"))
        tcs = (trs[self.hr] if len(trs) > self.hr else trs[-1]).findall(qn("a:tc"))
        self.font = []
        for tc in tcs:
            rp = _style_of(tc)[1]
            self.font.append(int(rp.get("sz")) / 100 if rp is not None and rp.get("sz") else None)
        # 칸별 (좌+우 여백, 위+아래 여백). 지정이 없으면 PowerPoint 기본값 0.1인치/0.05인치
        self.mar = []
        for tc in tcs:
            pr = tc.find(qn("a:tcPr"))
            g = (lambda k, d: int(pr.get(k, d)) if pr is not None else d)
            self.mar.append((g("marL", 91440) + g("marR", 91440), g("marT", 45720) + g("marB", 45720)))
        known = [f for f in self.font if f]
        self.font = [f or (known[0] if known else 10.0) for f in self.font]
        self.top = shape.top
        # 표 아래 한계선: 슬라이드 높이 × BOTTOM_RATIO,
        #   또는 표와 가로로 겹치면서 표 아래쪽에 있는 다른 도형의 윗변 중 더 위쪽 값
        orig_bottom = shape.top + sum(int(tr.get("h")) for tr in trs)
        limit = int(slide_h * BOTTOM_RATIO)
        for o in slide.shapes:
            if o.shape_id == shape.shape_id or o.top is None or o.left is None:
                continue
            overlaps = o.left < shape.left + shape.width and o.left + o.width > shape.left
            if overlaps and o.top >= orig_bottom - 30000:
                limit = min(limit, o.top - 40000)
        # 한계선이 너무 가까우면(헤더+3행도 안 들어가면) 무시
        if limit - self.top < self.head_h + self.row_h * 3:
            limit = int(slide_h * BOTTOM_RATIO)
        self.avail = limit - self.top - self.head_h

    # 행 높이 추정: 칸마다 (글자 폭 합 ÷ 칸 너비)로 줄 수를 계산해 가장 많은 줄 수 기준 높이 사용
    #   f: 글자 크기 배율. 결과는 템플릿 행 높이(f<1이면 비례 축소)보다 작아지지 않음
    def row_height(self, row, f=1.0):
        cells = row["cells"]
        idx = list(range(len(self.col_w)))
        widths = list(self.col_w)
        if row["hspan"]:
            c1, c2 = row["hspan"]
            idx = [c1] + idx[c2 + 1:]
            widths = [sum(self.col_w[c1:c2 + 1])] + self.col_w[c2 + 1:]
        need = 0
        for j, i in enumerate(idx):
            txt = cells[j] if j < len(cells) else ""
            pt = self.font[i] * f
            cap = max(1.0, (widths[j] - self.mar[i][0]) / (pt * 12700))
            n = sum(max(1, -(-_text_em(line) // cap)) for line in (txt.split("\n") if txt else [""]))
            need = max(need, int(n * pt * LINE_SPACING * 12700 + self.mar[i][1]))
        return max(need, int(self.row_h * (1.0 if f >= 1 else f * 0.8)))


def merge_header_col(tbl, col):
    """헤더 영역에서 위아래로 나뉜 한 열을 한 칸으로 병합 (예: '용도 및' + '사용 범위')"""
    hr = header_row_count(tbl)
    if hr < 2 or col >= len(tbl.columns):
        return
    top = tbl.cell(0, col)
    if top.is_merge_origin or top.is_spanned:
        return
    texts = [tbl.cell(r, col).text.strip() for r in range(hr)]
    style = _style_of(top._tc)
    for r in range(1, hr):
        _set_tc_text(tbl.cell(r, col)._tc, "", style)
    top.merge(tbl.cell(hr - 1, col))
    _set_tc_text(top._tc, " ".join(t for t in texts if t), style)


# 공백·'/'로 나눈 단어 중 가장 긴 단어의 폭(em). 열 최소 너비 계산용
def _words_em(txt):
    return max([_text_em(w) for w in re.split(r"[\s/]+", txt or "") if w] or [0])


# 열 너비 계산 기준
#   nat: 줄바꿈 없이 한 줄에 들어가는 폭, mn: 가장 긴 단어가 들어가는 최소 폭
#   데이터가 모두 빈 열은 템플릿 너비 × EMPTY_COL_SCALE로 고정
def autofit_widths(tbl, geo, rows, key=""):
    """엑셀 자동 맞춤처럼 열 너비 계산. 표 전체 너비는 유지"""
    n = len(geo.col_w)
    total = sum(geo.col_w)
    em = [geo.font[c] * 12700 for c in range(n)]
    nat, mn, empty = [0] * n, [0] * n, [True] * n
    for row in rows:
        if row["hspan"]:
            continue
        for c in range(min(n, len(row["cells"]))):
            t = row["cells"][c]
            if t:
                empty[c] = False
                nat[c] = max(nat[c], max(_text_em(x) for x in t.split("\n")) * em[c] * 1.05)
                mn[c] = max(mn[c], _words_em(t) * em[c] * 1.05)
    hdr_em = []
    for c in range(n):  # 헤더 글자 크기 (데이터와 다를 수 있음)
        rp = _style_of(tbl.cell(0, c)._tc)[1]
        hdr_em.append(int(rp.get("sz")) / 100 * 12700 if rp is not None and rp.get("sz") else em[c])
    for r in range(geo.hr):  # 헤더는 줄바꿈 단위(엔터) 기준으로 한 줄에 들어가게 → 헤더 높이 유지
        for c in range(n):
            cell = tbl.cell(r, c)
            if cell.is_spanned or (cell.is_merge_origin and cell.span_width > 1):
                continue
            lines = re.split(r"[\n\x0b]", cell.text or "")
            longest = max([_text_em(x.strip()) for x in lines] or [0])
            if longest > 7:  # 긴 헤더(예: '용도 및 사용 범위')는 단어 단위로 줄바꿈 허용
                longest = max(_words_em(cell.text), 4)
            mn[c] = max(mn[c], longest * hdr_em[c] * 1.1)
    scale = EMPTY_COL_SCALE.get(key, 1.0)
    fixed = [None] * n
    for c in range(n):
        mar = geo.mar[c][0] + 20000
        nat[c] = max(nat[c], mn[c]) + mar
        mn[c] = mn[c] + mar
        if empty[c]:
            fixed[c] = max(mn[c], geo.col_w[c] * scale)
    idx = [c for c in range(n) if fixed[c] is None]
    free = total - sum(f for f in fixed if f)
    if not idx:
        return list(geo.col_w)
    if sum(mn[c] for c in idx) >= free:  # 최소폭도 안 들어가면 최소폭 비율로
        sm = sum(mn[c] for c in idx)
        w = {c: mn[c] * free / sm for c in idx}
    else:
        # 최소폭에서 시작해서, 표 전체 높이(줄 수 합)가 가장 많이 줄어드는 열에 폭을 조금씩 배분
        data = [r for r in rows if not r["hspan"]]
        w = {c: mn[c] for c in idx}

        def lines(c, width):
            cap = max(1.0, (width - geo.mar[c][0] - 20000) / (em[c] * 1.05))
            out = []
            for r in data:
                t = r["cells"][c] if c < len(r["cells"]) else ""
                out.append(sum(max(1, -(-_text_em(x) // cap)) for x in (t.split("\n") if t else [""])))
            return out

        cur = {c: lines(c, w[c]) for c in idx}

        def total_lines(cur_map):
            return sum(max(cur_map[c][i] for c in idx) for i in range(len(data))) if data else 0

        step = max(20000, (free - sum(w.values())) / 300)
        remain = free - sum(w.values())
        while remain > step:
            base = total_lines(cur)
            best, best_gain = None, 0
            for c in idx:
                if w[c] >= nat[c]:
                    continue
                trial = dict(cur)
                trial[c] = lines(c, w[c] + step)
                gain = base - total_lines(trial)
                if gain > best_gain:
                    best, best_gain = c, gain
            if best is None:
                break
            w[best] += step
            cur[best] = lines(best, w[best])
            remain -= step
        # 남는 폭: 아직 자연폭에 못 미친 열 우선, 그다음 전체에 내용 길이 비율로
        short = [c for c in idx if w[c] < nat[c]]
        while remain > 1 and short:
            add = remain / len(short)
            for c in list(short):
                inc = min(add, nat[c] - w[c])
                w[c] += inc
                remain -= inc
                if w[c] >= nat[c] - 1:
                    short.remove(c)
        if remain > 1:
            sm = sum(nat[c] for c in idx)
            for c in idx:
                w[c] += remain * nat[c] / sm
    # 반올림 오차는 마지막 열에서 조정해 전체 너비를 원래와 같게 맞춤
    out = [int(fixed[c]) if fixed[c] else int(w[c]) for c in range(n)]
    out[-1] += total - sum(out)
    return out


def task_name(sh):
    """업무명: '서버' 행이 속한 업무(A열) 값. 없으면 첫 번째 업무 값"""
    cur, first = "", ""
    for r in range(3, sh.last_row(3) + 1):
        a = str(sh.val(r, 1) or "").strip()
        if a and a not in ("업무",):
            cur = a
            if not first and a.upper() not in ("ETC", "NW", "LICENSE", "H/W", "S/W"):
                first = a
        if str(sh.val(r, 2) or "").strip() == "서버" and cur:
            return cur
    return first


def _replace_span(para, start, end, new):
    """문단의 [start, end) 글자 구간을 new로 교체 (run 서식 유지)"""
    pos, done = 0, False
    for run in para.runs:
        t = run.text
        a, b = pos, pos + len(t)
        pos = b
        if b <= start or a >= end:
            continue
        s0, e0 = max(start, a) - a, min(end, b) - a
        run.text = t[:s0] + ("" if done else new) + t[e0:]
        done = True


# 텍스트가 있는 도형을 순회. 그룹 도형(shape_type 6)은 안쪽 도형까지 순회
def _iter_text_shapes(shapes):
    for shp in shapes:
        if shp.shape_type == 6:
            yield from _iter_text_shapes(shp.shapes)
        elif shp.has_text_frame:
            yield shp


# 문단의 pos 글자 위치에 new 문자열 삽입 (해당 위치가 속한 run에 삽입)
def _insert_at(para, pos, new):
    acc = 0
    runs = list(para.runs)
    for run in runs:
        if acc <= pos <= acc + len(run.text):
            run.text = run.text[:pos - acc] + new + run.text[pos - acc:]
            return
        acc += len(run.text)


# 모든 슬라이드 문단에 TITLE_RULES를 차례로 적용해, 일치하는 첫 규칙으로 업무명을 교체 또는 삽입
#   n 그룹: 그 자리를 업무명으로 교체 / ins 그룹: 그 앞에 '업무명 ' 삽입
def replace_titles(prs, name, log):
    if not name:
        return
    pats = [re.compile(p) for p in TITLE_RULES]
    cnt = 0
    for slide in prs.slides:
        for shp in _iter_text_shapes(slide.shapes):
            for para in shp.text_frame.paragraphs:
                text = "".join(r.text for r in para.runs)
                for pat in pats:
                    m = pat.match(text)
                    if not m:
                        continue
                    n = m.groupdict().get("n")
                    if n is not None:
                        if n.strip().upper() in TITLE_STOPWORDS or n == name:
                            break
                        _replace_span(para, m.start("n"), m.end("n"), name)
                    elif "ins" in m.groupdict() and m.group("ins"):
                        _insert_at(para, m.start("ins"), name + " ")
                    else:
                        break
                    cnt += 1
                    break
    log.append(f"[완료] 제목 업무명 → '{name}' ({cnt}곳)")


# NOWRAP_TEXTS에 해당하는 문구만 있는 도형은 자동 줄바꿈 해제
def fix_nowrap(prs):
    for slide in prs.slides:
        for shp in _iter_text_shapes(slide.shapes):
            if shp.text_frame.text.strip().replace(" ", "") in NOWRAP_TEXTS:
                shp.text_frame.word_wrap = False


def layout(blocks, geo, font_min=1.0, one_page=False):
    """블록(붙어 있어야 하는 행 묶음)을 페이지로 나눔 → (pages, heights, font_scale, overflow)"""
    def split(f):
        hs = [[geo.row_height(r, f) for r in b] for b in blocks]
        if one_page:
            return [[r for b in blocks for r in b]], [[h for x in hs for h in x]]
        pages, heights, cur, cur_h, used = [], [], [], [], 0
        for b, h in zip(blocks, hs):
            if cur and used + sum(h) > geo.avail:
                pages.append(cur)
                heights.append(cur_h)
                cur, cur_h, used = [], [], 0
            cur += b
            cur_h += h
            used += sum(h)
        pages.append(cur)
        heights.append(cur_h)
        return pages, heights

    # 글자 배율을 1.0부터 font_min까지 0.05씩 줄이며 분할 결과를 모두 계산한 뒤,
    #   (페이지 수가 적은 것 → 넘치는 높이가 작은 것 → 글자가 큰 것) 순으로 하나 선택
    cands, f = [], 1.0
    while f >= font_min - 1e-9:
        pages, heights = split(f)
        over = max(sum(h) for h in heights) > geo.avail
        excess = max(0, max(sum(h) for h in heights) - geo.avail)
        cands.append((len(pages), excess, -f, pages, heights, f, over))
        f = round(f - 0.05, 2)
    best = min(cands, key=lambda c: (c[0], c[1], c[2]))
    return best[3], best[4], best[5], best[6]


# 슬라이드 복제: 같은 레이아웃으로 새 슬라이드를 만들고 원본 도형을 복사
#   그림 등 관계(rId)는 새 슬라이드에 다시 연결하고, 새 슬라이드를 insert_after_index 바로 뒤로 이동
def duplicate_slide(prs, src_slide, insert_after_index):
    new = prs.slides.add_slide(src_slide.slide_layout)
    for shp in list(new.shapes):
        shp._element.getparent().remove(shp._element)
    rid_map = {}
    for rid, rel in src_slide.part.rels.items():
        if rel.reltype.endswith(("/slideLayout", "/notesSlide")):
            continue
        if rel.is_external:
            rid_map[rid] = new.part.relate_to(rel.target_ref, rel.reltype, is_external=True)
        else:
            rid_map[rid] = new.part.relate_to(rel.target_part, rel.reltype)
    tree = new.shapes._spTree
    for el in src_slide.shapes._spTree:
        if el.tag.endswith(("}nvGrpSpPr", "}grpSpPr", "}extLst")):
            continue
        el2 = deepcopy(el)
        for node in el2.iter():
            for att in list(node.attrib):
                if att.startswith("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"):
                    if node.attrib[att] in rid_map:
                        node.attrib[att] = rid_map[node.attrib[att]]
        tree.append(el2)
    lst = prs.slides._sldIdLst
    el = lst[-1]
    lst.remove(el)
    lst.insert(insert_after_index + 1, el)
    return new


# 슬라이드 목록과 관계에서 해당 슬라이드 제거
def delete_slide(prs, slide):
    lst = prs.slides._sldIdLst
    for sid in list(lst):
        if prs.part.related_part(sid.rId) is slide.part:
            prs.part.drop_rel(sid.rId)
            lst.remove(sid)
            return


# SIGNATURES[key] 조건에 맞는 표가 있는 슬라이드 목록 반환: [(슬라이드, 표 도형 이름), ...]
def find_targets(prs, key):
    sig = SIGNATURES[key]
    found = []
    for idx, slide in enumerate(prs.slides):
        for shp in slide.shapes:
            if shp.has_table and sig(_hdr(shp.table)):
                found.append((slide, shp.name))
                break
    return found


# 표 하나(key)를 템플릿에 채우는 전체 순서:
#   1) 표 찾기 → 2) 헤더 병합·문구 수정 → 3) 열 너비 자동 맞춤(AUTOFIT) → 4) 페이지 분할(layout)
#   5) 페이지 수만큼 슬라이드 복제 → 6) 각 슬라이드 표 채우기(fill_table) → 7) 남는 템플릿 슬라이드 삭제
def place(prs, key, blocks, opts, log):
    targets = find_targets(prs, key)
    if not targets:
        log.append(f"[건너뜀] {key}: 템플릿에서 해당 표를 찾지 못함")
        return
    # 같은 표가 여러 장이면 첫 장을 원본으로 삼아 모든 페이지 모양을 통일 (나머지는 마지막에 삭제)
    extra_slides = [sl for sl, _ in targets[1:]]
    slide0, name = targets[0]
    shp0 = next(x for x in slide0.shapes if x.name == name and x.has_table)
    for col in HEADER_MERGE.get(key, []):
        merge_header_col(shp0.table, col)
    fix_header_text(shp0.table, HEADER_TEXT_FIX.get(key, []))
    geo = Geometry(slide0, shp0, prs.slide_height)
    if key in AUTOFIT:
        widths = autofit_widths(shp0.table, geo, [r for b in blocks for r in b], key)
        for c, w in zip(shp0.table.columns, widths):
            c.width = w
        geo.col_w = widths
    pages, heights, fscale, overflow = layout(blocks, geo, FONT_MIN.get(key, 1.0), key in ONE_PAGE_ONLY)
    targets = [(slide0, name)]
    while len(targets) < len(pages):
        idx = list(prs.slides).index(targets[-1][0])
        targets.append((duplicate_slide(prs, slide0, idx), name))
    for (slide, nm), page, hs in zip(targets, pages, heights):
        shp = next(x for x in slide.shapes if x.name == nm and x.has_table)
        fill_table(shp, page, dict(opts, body_plain=key in BODY_PLAIN), hs, fscale)
    for sl in extra_slides:
        delete_slide(prs, sl)
    nos = [list(prs.slides).index(sl) + 1 for sl, _ in targets]
    note = f" (글자 {int(round(fscale*100))}%)" if fscale < 1 else ""
    if overflow:
        note += " ※ 표가 슬라이드 아래로 넘칠 수 있음, 확인 필요"
    log.append(f"[완료] {key}: {sum(len(p) for p in pages)}행 → 슬라이드 {nos}{note}")


# 헤더 칸 문구가 rules의 old와 같으면(공백 무시) new로 교체. 서식은 유지
def fix_header_text(tbl, rules):
    hr = header_row_count(tbl)
    for r in range(hr):
        for c in range(len(tbl.columns)):
            cell = tbl.cell(r, c)
            if cell.is_spanned:
                continue
            for old, new in rules:
                if _norm(cell.text) == _norm(old):
                    _set_tc_text(cell._tc, new, _style_of(cell._tc))



# ===========================================================================
# 구성도 (Architecture 슬라이드) - TO-BE 서버 박스를 서버 목록만큼 그림
# ===========================================================================
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


# 슬라이드 안 도형 id 최대값 다음 번호부터 차례로 생성 (복사한 도형의 id 중복 방지)
def _id_gen(slide):
    ids = [int(e.get("id")) for e in slide.shapes._spTree.iter() if e.tag.endswith("}cNvPr") and e.get("id", "").isdigit()]
    n = max(ids or [1000])
    while True:
        n += 1
        yield n


# 복사한 도형의 id를 새 번호로 바꾸고, 연결선의 시작/끝 연결 정보(stCxn/endCxn)는 제거
def _reid(el, gen):
    for e in el.iter():
        if e.tag.endswith("}cNvPr"):
            e.set("id", str(next(gen)))
        if e.tag in (qn("a:stCxn"), qn("a:endCxn")):
            e.getparent().remove(e)
    return el


def _xfrm(el):
    """도형/그룹의 a:xfrm"""
    for tag in ("p:spPr", "p:grpSpPr"):
        pr = el.find(qn(tag))
        if pr is not None and pr.find(qn("a:xfrm")) is not None:
            return pr.find(qn("a:xfrm"))
    return None


# 도형 위치(x, y)와 크기(cx, cy)를 EMU 단위로 설정. None인 값은 변경하지 않음
def _set_xy(el, x=None, y=None, cx=None, cy=None):
    xf = _xfrm(el)
    off, ext = xf.find(qn("a:off")), xf.find(qn("a:ext"))
    if x is not None:
        off.set("x", str(int(x)))
    if y is not None:
        off.set("y", str(int(y)))
    if cx is not None:
        ext.set("cx", str(int(cx)))
    if cy is not None:
        ext.set("cy", str(int(cy)))


# 도형의 (x, y, cx, cy) 반환 (그룹 안 도형이면 그룹 내부 좌표)
def _get_xy(el):
    xf = _xfrm(el)
    off, ext = xf.find(qn("a:off")), xf.find(qn("a:ext"))
    return int(off.get("x")), int(off.get("y")), int(ext.get("cx")), int(ext.get("cy"))


# 도형 안 모든 텍스트를 이어 붙여 반환
def _el_text(el):
    return "".join(t.text or "" for t in el.iter(qn("a:t")))


def _set_sp_text(sp, lines, font_scale=1.0, first_bold=None):
    """도형 텍스트 교체. 각 줄은 원래 같은 순번 문단의 서식을 따름 (없으면 마지막 문단 서식)"""
    body = sp.find(qn("p:txBody"))
    paras = body.findall(qn("a:p"))
    styles = []
    for p in paras:
        ppr = p.find(qn("a:pPr"))
        rpr = p.find(qn("a:r") + "/" + qn("a:rPr"))
        if rpr is None:
            rpr = p.find(qn("a:endParaRPr"))
        styles.append((deepcopy(ppr) if ppr is not None else None, deepcopy(rpr) if rpr is not None else None))
    if not styles:
        styles = [(None, None)]
    for p in paras:
        body.remove(p)
    for i, line in enumerate(lines or [""]):
        ppr, rpr = styles[min(i, len(styles) - 1)]
        if font_scale < 1.0:
            rpr = _scaled(rpr, font_scale)
        p = body.makeelement(qn("a:p"), {})
        if ppr is not None:
            p.append(deepcopy(ppr))
        if line:
            r = p.makeelement(qn("a:r"), {})
            rp = deepcopy(rpr) if rpr is not None else r.makeelement(qn("a:rPr"), {"lang": "ko-KR"})
            rp.tag = qn("a:rPr")
            if first_bold is not None:
                rp.set("b", "1" if (first_bold and i == 0) else "0")
            r.append(rp)
            t = r.makeelement(qn("a:t"), {})
            t.text = line
            r.append(t)
            p.append(r)
        body.append(p)


# H/W 장비 중 서버만 반환
def server_list(sh, cpu_db):
    return [o for o in hw_items(sh, cpu_db) if o.get("kind") == "server"]



def _role_key(host):
    """호스트명에서 역할 이름과 꼬리표(A/S 또는 번호) 분리. 꼬리표가 없으면 None"""
    h = host.strip()
    m = re.match(r"^(.+?)[-_=]\s*([AS])$", h, re.I)
    if m:
        return m.group(1).strip(), "AS", m.group(2).upper(), "-"
    m = re.match(r"^(.*?[^\d\-_])([-_]?)(\d{1,3})$", h)
    if m:
        return m.group(1), "NUM", m.group(3), m.group(2)
    return None


# 중복을 제외하고 순서를 유지해 sep로 연결
def _join_distinct(vals, sep="/"):
    out = []
    for v in vals:
        if v and v not in out:
            out.append(v)
    return sep.join(out)


# _role_key 결과(역할 이름, 꼬리표 종류)가 같은 서버를 한 항목으로 묶음
#   호스트명은 '역할이름-A/S' 또는 '역할이름01/02' 형태, 수량은 합계, 사양 값은 서로 다른 값만 '/'로 연결
#   members: 묶인 원래 호스트명 목록
def group_servers_by_role(servers):
    groups, order = {}, []
    for sv in servers:
        rk = _role_key(sv["host"])
        key = (rk[0].upper(), rk[1]) if rk else ("#" + sv["host"], "")
        if key not in groups:
            groups[key] = {"rk": rk, "items": []}
            order.append(key)
        groups[key]["items"].append(sv)
    out = []
    for key in order:
        g, items = groups[key], groups[key]["items"]
        if len(items) == 1:
            out.append(dict(items[0], members=[items[0]["host"]]))
            continue
        base, kind, _, sep = g["rk"]
        tags = [_role_key(x["host"])[2] for x in items]
        host = f"{base}{sep}{'/'.join(tags)}"
        merged = dict(items[0], host=host, qty=sum(x["qty"] for x in items), members=[x["host"] for x in items])
        for f in ("manuf", "model", "os", "speed", "core", "cpu_qty", "mem"):
            vals = [x.get(f, "") for x in items if x.get(f, "") not in ("", "-")]
            merged[f] = _join_distinct(vals) or items[0].get(f, "")
        out.append(merged)
    return out


# 반환: (구성도용 서버 목록, 전체 H/W 장비 목록)
#   ARCH_GROUP_BY_ROLE이 True면 서버를 역할별로 묶음
def arch_servers(sh, cpu_db):
    items = hw_items(sh, cpu_db, group=not ARCH_GROUP_BY_ROLE)
    servers = [o for o in items if o.get("kind") == "server"]
    return group_servers_by_role(servers) if ARCH_GROUP_BY_ROLE else servers, items


def fill_sw_architecture(prs, servers, log):
    """'Private Network'이 있는 SW 구성도: TO-BE 박스를 서버 수만큼 다시 그림"""
    # 'Private Network' 문구가 있는 그룹 도형이 없으면, SW Configuration 슬라이드는 템플릿 그대로 두고 로그만 남김
    found = any("Private Network" in _el_text(sh._element) for sl in prs.slides for sh in sl.shapes
                if sh.shape_type == 6)
    if not found:
        for idx, slide in enumerate(prs.slides):
            if any("SW" in _el_text(sh._element) and "Configuration" in _el_text(sh._element)
                   for sh in slide.shapes if sh.has_text_frame):
                log.append(f"[건너뜀] SW 구성도: 템플릿 구성이 달라 자동 작성하지 않음 (슬라이드 {idx + 1}, 템플릿 내용 유지)")
        return
    for idx, slide in enumerate(prs.slides):
        outer = None
        for shp in slide.shapes:
            if shp.shape_type == 6 and "Private Network" in _el_text(shp._element):
                outer = shp._element
                break
        if outer is None:
            continue
        # 그룹 안의 서버 박스(하위 그룹)와 세로 연결선을 견본으로 보관한 뒤 모두 삭제
        boxes = [e for e in outer if e.tag == qn("p:grpSp")]
        if not boxes or not servers:
            continue
        vlines = [e for e in outer if e.tag == qn("p:cxnSp") and _get_xy(e)[2] < _get_xy(e)[3]]
        pos = sorted(_get_xy(b) for b in boxes)
        left, top, bw, bh = pos[0]
        right = max(x + w for x, y, w, h in pos)
        gap0 = (pos[1][0] - (pos[0][0] + bw)) if len(pos) > 1 else bw * 0.15
        tmpl_box = deepcopy(sorted(boxes, key=lambda b: _get_xy(b)[0])[0])
        black = [l for l in vlines if "tx1" in "".join(x.get("val", "") for x in l.iter())]
        tmpl_line = deepcopy(black[0] if black else (vlines[0] if vlines else None))
        line_y, line_h = (_get_xy(tmpl_line)[1], _get_xy(tmpl_line)[3]) if tmpl_line is not None else (0, 0)
        for e in boxes + vlines:
            outer.remove(e)

        n = len(servers)
        area = right - left
        gap = min(gap0, area * 0.25 / max(n - 1, 1))
        w = min(bw, (area - gap * (n - 1)) / n)
        start = left + (area - (w * n + gap * (n - 1))) / 2
        fs = max(0.6, min(1.0, w / bw * 1.15))
        gen = _id_gen(slide)
        for i, sv in enumerate(servers):
            box = _reid(deepcopy(tmpl_box), gen)
            x = start + i * (w + gap)
            _set_xy(box, x=x, cx=w)  # 그룹을 가로로 늘이고 줄이면 안쪽 도형도 같이 맞춰짐
            sps = [e for e in box if e.tag == qn("p:sp")]
            texts = [e for e in sps if _el_text(e).strip()]
            texts.sort(key=lambda e: _get_xy(e)[1])
            if texts:  # 박스 제목 칸을 박스 폭에 맞게 넓힘 (호스트명이 길어도 한 줄)
                cont = max(sps, key=lambda e: _get_xy(e)[2] * _get_xy(e)[3])
                bx, _, bcw, _ = _get_xy(cont)
                _set_xy(texts[0], x=bx + bcw * 0.06, cx=bcw * 0.88)
                _set_sp_text(texts[0], [sv["host"]], fs)
                for k, e in enumerate(texts[1:]):
                    _set_sp_text(e, [sv.get("os", "")] if k == 0 else [""], fs)
            outer.append(box)
            if tmpl_line is not None:
                ln = _reid(deepcopy(tmpl_line), gen)
                _set_xy(ln, x=x + w / 2)
                outer.append(ln)
        log.append(f"[완료] SW 구성도: TO-BE 서버 박스 {n}개 → 슬라이드 {idx + 1}")


def _abs_box(el):
    """그룹 안 도형도 슬라이드 기준 좌표로 (x, y, cx, cy)"""
    x, y, cx, cy = _get_xy(el)
    par = el.getparent()
    while par is not None and par.tag == qn("p:grpSp"):
        xf = _xfrm(par)
        off, ext = xf.find(qn("a:off")), xf.find(qn("a:ext"))
        cho, che = xf.find(qn("a:chOff")), xf.find(qn("a:chExt"))
        sx = int(ext.get("cx")) / max(1, int(che.get("cx")))
        sy = int(ext.get("cy")) / max(1, int(che.get("cy")))
        x = int(off.get("x")) + (x - int(cho.get("x"))) * sx
        y = int(off.get("y")) + (y - int(cho.get("y"))) * sy
        cx, cy = cx * sx, cy * sy
        par = par.getparent()
    return x, y, cx, cy


# 그림 도형이 참조하는 이미지 관계 id (같은 이미지인지 비교용)
def _blip_rid(pic):
    b = pic.find(".//" + qn("a:blip"))
    return b.get("{%s}embed" % NS_R) if b is not None else None


# _SPEC_LABEL: 서버 사양 라벨 판별 문구 / _KEEP_LABEL: 지우지 않고 유지할 라벨 문구 / _HOSTLIKE: 호스트명 형태
_SPEC_LABEL = re.compile(r"(MEM|GHz|Ghz|core|Core)")
_KEEP_LABEL = re.compile(r"(STORAGE|SWITCH|SAN|ACTIVE|STANDBY|MIRERO|SAMSUNG|^VM$|^GUEST$)", re.I)
_HOSTLIKE = re.compile(r"^[A-Za-z0-9]+[-_][A-Za-z0-9\-_/=]+")


# VM 목록을 읽을 시트 이름
RESOURCE_SHEET = "리소스 산정"


# VM 목록에서 제외할 항목 (VM이 아닌 가상화 계층 표시)
VM_EXCLUDE = re.compile(r"^(hypervisor|esxi|vsphere)$", re.I)
# 관리용 VM은 목록 맨 아래에 표시
VM_LAST = re.compile(r"^(vcenter)$", re.I)


def read_vms(wb):
    """리소스 산정 시트: 장비구분(F열)이 VM인 B.M 호스트(D열)별 VM GUEST(E열) 목록 → [(호스트, [VM...]), ...]
    D·F열이 병합돼 있으면 위 값을 이어받음. 'Hypervisor' 행은 제외"""
    if RESOURCE_SHEET not in wb.sheetnames:
        return []
    ws = wb[RESOURCE_SHEET]
    hdr = None
    for r in range(1, min(ws.max_row, 30) + 1):
        v = str(ws.cell(r, 5).value or "").upper()
        if "VM" in v and "GUEST" in v:
            hdr = r
            break
    if hdr is None:
        return []
    out, cur, kind, started = [], "", "", False
    for r in range(hdr + 1, ws.max_row + 1):
        b, c, d, e, f = (str(ws.cell(r, k).value or "").strip() for k in (2, 3, 4, 5, 6))
        if b.startswith("■") or (started and not any((b, c, d, e, f))):
            break
        if not started and not (c or d or e):
            continue  # 헤더 아래 하위 제목 행
        started = True
        if d:
            cur, kind = d, ""
        if f:
            kind = f.upper().replace(" ", "")
        if not e or not cur or kind != "VM":
            continue
        for vm in re.split(r"[\n,]+", e):
            vm = vm.strip()
            if not vm or VM_EXCLUDE.match(vm):
                continue
            if not out or out[-1][0] != cur:
                out.append((cur, []))
            out[-1][1].append(vm)
    return [(h, [v for v in vs if not VM_LAST.match(v)] + [v for v in vs if VM_LAST.match(v)]) for h, vs in out]


# 서버마다 수량만큼(최대 6개) 아이콘을 가로로 배치하고, 아래에 '호스트명 / (제조사/모델 / 클럭, CPU수/코어, 메모리)' 라벨 배치
def fill_hw_architecture(prs, items, log, servers=None, vms=None):
    """'구분/구성' 표가 있는 HW 구성도: TO-BE 서버(아이콘+라벨)를 서버 수만큼 다시 그리고 스토리지·스위치 라벨 갱신"""
    if servers is None:
        servers = [o for o in items if o.get("kind") == "server"]
    for idx, slide in enumerate(prs.slides):
        tbl_shp = next((x for x in slide.shapes if x.has_table and _hdr(x.table) == ["구분", "구성"]), None)
        if tbl_shp is None or not servers:
            continue
        trs = tbl_shp.table._tbl.findall(qn("a:tr"))
        if len(trs) < 2:
            continue
        # TO-BE 영역: '구분/구성' 표의 마지막 행 범위 (세로는 마지막 행 윗변부터, 가로는 2번째 열)
        band_top = tbl_shp.top + sum(int(tr.get("h")) for tr in trs[:-1])  # 마지막 행 = TO-BE
        band_left = tbl_shp.left + tbl_shp.table.columns[0].width
        band_right = tbl_shp.left + tbl_shp.width
        tree = slide.shapes._spTree

        def in_band(e):
            return _abs_box(e)[1] >= band_top - 50000

        # 서버 아이콘 = TO-BE 영역에서 가장 많이 쓰인 그림, 라벨 = 사양(MEM/GHz)이 적힌 상자
        pics = [pc for pc in tree.iter(qn("p:pic")) if in_band(pc)]
        cnt = {}
        for pc in pics:
            cnt[_blip_rid(pc)] = cnt.get(_blip_rid(pc), 0) + 1
        icon_rid = max(cnt, key=cnt.get) if cnt else None
        icons = [pc for pc in pics if _blip_rid(pc) == icon_rid]
        labels = [e for e in tree.iter(qn("p:sp")) if in_band(e) and _SPEC_LABEL.search(_el_text(e))
                  and not _KEEP_LABEL.search(_el_text(e))]
        if not icons or not labels:
            log.append(f"[건너뜀] HW 구성도: 서버 아이콘/라벨 견본을 찾지 못함 (슬라이드 {idx + 1})")
            continue
        ib = [_abs_box(e) for e in icons]
        lb = [_abs_box(e) for e in labels]
        icon_w, icon_h = ib[0][2], ib[0][3]
        icon_y = min(b[1] for b in ib)
        lab_y = min(b[1] for b in lb)
        lab_w0, lab_h = lb[0][2], lb[0][3]
        lab_bottom = lab_y + lab_h + 30000
        server_boxes = ib + lb
        icon_tmpl, label_tmpl = deepcopy(icons[0]), deepcopy(labels[0])

        def over_server(box, pad=30000):
            x, y, cx, cy = box
            return any(x + cx >= sx - pad and x <= sx + scx + pad for sx, sy, scx, scy in server_boxes)

        # TO-BE 영역의 기존 서버 아이콘·라벨·세로선·VM 상자를 삭제 대상으로 수집. 세로선 하나는 견본으로 보관
        dash_tmpl, to_remove = None, []
        for e in list(tree):
            if e.tag not in (qn("p:sp"), qn("p:grpSp"), qn("p:pic"), qn("p:cxnSp")) or e is tbl_shp._element:
                continue
            box = _abs_box(e)
            if e.tag == qn("p:cxnSp"):
                # 서버에서 위/아래 네트워크로 이어지는 세로선 (서버 줄 높이에 걸치는 것)
                if (box[2] < 20000 and over_server(box) and box[1] < lab_bottom + 400000
                        and box[1] + box[3] > band_top):
                    dash_tmpl = dash_tmpl if dash_tmpl is not None else deepcopy(e)
                    to_remove.append(e)
                continue
            if box[1] < band_top - 50000:
                continue
            txt = _el_text(e).strip()
            has_icon = any(_blip_rid(pc) == icon_rid for pc in e.iter(qn("p:pic")))
            if has_icon or any(e is l for l in labels) or any(l in e.iter(qn("p:sp")) for l in labels):
                to_remove.append(e)
                continue
            if e.tag in (qn("p:sp"), qn("p:grpSp")) and txt and not _KEEP_LABEL.search(txt):
                has_pic = any(True for _ in e.iter(qn("p:pic")))
                # 서버 아래 VM/호스트 이름 상자들
                if not has_pic and box[1] >= lab_y - 50000 and (_HOSTLIKE.match(txt) or e.tag == qn("p:grpSp")
                                                                or txt.lower() == "vcenter"):
                    to_remove.append(e)
        # VM 상자 견본: 지울 대상 안의 호스트 이름 상자(큰 것 = 물리 호스트, 작은 것 = VM)
        vm_host_t = vm_guest_t = None
        vm_geo = None
        hosts_b, guests_b = [], []
        for e in to_remove:
            for sp in ([e] if e.tag == qn("p:sp") else list(e.iter(qn("p:sp")))):
                t = _el_text(sp).strip()
                if not t or _SPEC_LABEL.search(t) or _KEEP_LABEL.search(t):
                    continue
                bx = _abs_box(sp)
                (hosts_b if bx[3] > 400000 else guests_b).append((bx, sp))
        if hosts_b and guests_b:
            hosts_b.sort(key=lambda z: (z[0][0], z[0][1]))
            h0, hsp = hosts_b[0]
            inner = sorted([g for g in guests_b if h0[0] <= g[0][0] <= h0[0] + h0[2]
                            and h0[1] <= g[0][1] <= h0[1] + h0[3]], key=lambda z: z[0][1])
            if inner:
                g0 = inner[0][0]
                pitch_y = (inner[1][0][1] - g0[1]) if len(inner) > 1 else g0[3] * 1.2
                pitch_x = (hosts_b[1][0][0] - h0[0]) if len(hosts_b) > 1 else h0[2] * 1.05
                vm_host_t, vm_guest_t = deepcopy(hsp), deepcopy(inner[0][1])
                vm_geo = dict(x=h0[0], y=h0[1], w=h0[2], gx=g0[0] - h0[0], gy=g0[1] - h0[1],
                              gw=g0[2], gh=g0[3], py=pitch_y, px=pitch_x,
                              pad=max(30000, h0[3] - (inner[-1][0][1] - h0[1] + g0[3])))
        for e in to_remove:
            if e.getparent() is not None:
                e.getparent().remove(e)

        # 서버를 놓을 가로 범위: 서버 줄 높이에 걸치는 다른 도형(스위치 등) 왼쪽까지
        x_right = band_right - 80000
        for e in tree:
            if e.tag not in (qn("p:sp"), qn("p:grpSp"), qn("p:pic")) or e is tbl_shp._element:
                continue
            x, y, cx, cy = _abs_box(e)
            if y < lab_bottom and y + cy > icon_y and x > band_left + (band_right - band_left) * 0.35:
                x_right = min(x_right, x - 60000)
        band_left_srv = band_left + 80000

        # 가로로 긴 선(네트워크 선)의 y 좌표 수집 → 서버 위쪽/아래쪽 세로선이 닿을 위치 결정
        hl = []
        for e in list(tree.iter(qn("p:cxnSp"))) + list(tree.iter(qn("p:sp"))):
            if _xfrm(e) is None:
                continue
            x, y, cx, cy = _abs_box(e)
            if cx > 3000000 and cy < 60000 and y >= band_top - 50000:
                hl.append(y)
        up_to = max([h for h in hl if h < icon_y] or [band_top])
        down_to = min([h for h in hl if h > lab_bottom + 30000] or [lab_bottom + 200000])
        band_right_srv = x_right

        n = len(servers)
        slot = (band_right_srv - band_left_srv) / n
        lab_w = min(max(lab_w0, slot * 0.9), slot * 0.94)
        fs = max(0.75, min(1.0, lab_w / lab_w0))
        gen = _id_gen(slide)
        centers = []
        for i, sv in enumerate(servers):
            cx = band_left_srv + slot * (i + 0.5)
            centers.append(([h.upper() for h in sv.get("members", [sv["host"]])], cx))
            k = max(1, min(int(sv["qty"]), 6))
            iw = min(icon_w, lab_w / k)
            ih = icon_h * iw / icon_w
            x0 = cx - iw * k / 2
            for j in range(k):
                ic = _reid(deepcopy(icon_tmpl), gen)
                _set_xy(ic, x=x0 + j * iw, y=icon_y + (icon_h - ih), cx=iw, cy=ih)
                tree.append(ic)
                if dash_tmpl is not None:  # 위쪽 네트워크까지 세로선
                    ln = _reid(deepcopy(dash_tmpl), gen)
                    _set_xy(ln, x=x0 + j * iw + iw / 2, y=up_to, cx=0, cy=max(0, icon_y - up_to))
                    tree.append(ln)
            lab = _reid(deepcopy(label_tmpl), gen)
            _set_xy(lab, x=cx - lab_w / 2, y=lab_y, cx=lab_w, cy=lab_h)
            spec = []
            if sv.get("speed", "-") != "-" and sv.get("core", "-") != "-":
                spec.append(f"{sv['speed']}GHz, {sv.get('cpu_qty') or 1}P/{sv['core']}C")
            if sv.get("mem"):
                spec.append(f"{sv['mem']} MEM")
            lines = [sv["host"], f"({sv['manuf']}/{sv['model']}" + ("" if spec else ")")]
            if spec:  # 사양은 다음 줄로: (제조사/모델 ↵ 클럭, CPU/코어, 메모리)
                lines.append(", ".join(spec) + ")")
            _set_sp_text(lab, lines, fs, first_bold=True)
            tree.append(lab)
            if dash_tmpl is not None:  # 아래쪽 네트워크까지 세로선
                ln = _reid(deepcopy(dash_tmpl), gen)
                _set_xy(ln, x=cx, y=lab_bottom, cx=0, cy=max(0, down_to - lab_bottom))
                tree.append(ln)

        # VM: 리소스 산정 시트의 호스트별 VM 목록을 호스트 상자 안에 세로로 그림
        if vms:
            if vm_geo is None:
                log.append(f"[건너뜀] HW 구성도: 템플릿에 VM 상자 견본이 없어 VM은 그리지 않음 (슬라이드 {idx + 1})")
            else:
                g = vm_geo
                # 같은 서버 그룹(예: C1R-DM25-SVR-01/02/03)의 호스트들은 그 서버 아래 가운데에 모아서 배치
                cols, by_center, rest = [], {}, []
                for host, guests in vms:
                    c = next((cx for mem, cx in centers if host.upper() in mem), None)
                    (by_center.setdefault(c, []) if c is not None else rest).append((host, guests))
                for c, hs in by_center.items():
                    start = c - (len(hs) * g["px"] - (g["px"] - g["w"])) / 2
                    cols += [(start + i * g["px"], h, gs) for i, (h, gs) in enumerate(hs)]
                nxt = max([x for x, _, _ in cols] or [g["x"] - g["px"]]) + g["px"]
                cols += [(nxt + i * g["px"], h, gs) for i, (h, gs) in enumerate(rest)]
                for hx, host, guests in cols:
                    hh = g["gy"] + g["py"] * (len(guests) - 1) + g["gh"] + g["pad"]
                    hb = _reid(deepcopy(vm_host_t), gen)
                    _set_xy(hb, x=hx, y=g["y"], cx=g["w"], cy=hh)
                    _set_sp_text(hb, [host])
                    tree.append(hb)
                    for j, vm in enumerate(guests):
                        gb = _reid(deepcopy(vm_guest_t), gen)
                        _set_xy(gb, x=hx + g["gx"], y=g["y"] + g["gy"] + j * g["py"], cx=g["gw"], cy=g["gh"])
                        _set_sp_text(gb, [vm])
                        tree.append(gb)
                log.append(f"[완료] HW 구성도: VM {sum(len(v) for _, v in vms)}개 (호스트 {len(vms)}대)")

        # 스토리지 / 스위치 라벨 문구 갱신 (속도가 같은 스위치끼리 먼저 짝짓고, 남은 건 순서대로)
        others = [o for o in items if o.get("kind") != "server"]
        storages = [o for o in others if o.get("kind") == "storage"]
        def is_switch(o):
            t = (o["type"] + " " + o["host"]).upper()
            return "SWITCH" in t or "스위치" in t
        sans = [o for o in others if is_switch(o) and "SAN" in (o["type"] + o["host"]).upper()]
        sws = [o for o in others if is_switch(o) and o not in sans]
        lab_sto, lab_san, lab_sw = [], [], []
        for e in list(tree.iter(qn("p:sp"))):
            t = _el_text(e).strip().upper()
            if not t or _abs_box(e)[1] < band_top:
                continue
            if "STORAGE" in t:
                lab_sto.append(e)
            elif "SWITCH" in t and "SAN" in t:
                lab_san.append(e)
            elif "SWITCH" in t:
                lab_sw.append(e)

        def put(e, lines, widen=False):
            _set_sp_text(e, lines, first_bold=True)
            if widen:
                rp = e.find(".//" + qn("a:rPr"))
                pt = int(rp.get("sz")) / 100 if rp is not None and rp.get("sz") else 7
                need = max(_text_em(x) for x in lines) * pt * 12700 * 1.1 + 60000
                x, y, cx, cy = _get_xy(e)
                if need > cx:
                    _set_xy(e, x=x - (need - cx) / 2, cx=need)

        def speed(t):
            m = re.match(r"\s*(\d+G)", t.upper())
            return m.group(1) if m else ""

        for e, o in zip(lab_sto, storages):
            put(e, [f"{o['host']} Storage", f"{o['manuf']} {o['model']}"]
                + ([f"Usable {o['usable']}"] if o.get("usable") else []))
        for e, o in zip(lab_san, sans):
            put(e, ["SAN Switch", f"{o['manuf']} {o['model']}"])
        pairs, rest_l, rest_o = [], [], list(sws)
        for e in lab_sw:
            o = next((o for o in rest_o if speed(o["type"] or o["host"]) and
                      speed(o["type"] or o["host"]) == speed(_el_text(e))), None)
            if o:
                pairs.append((e, o))
                rest_o.remove(o)
            else:
                rest_l.append(e)
        pairs += list(zip(rest_l, rest_o))
        for e, o in pairs:
            put(e, [o["type"] or o["host"], f"{o['manuf']} {o['model']}"])
        unused = len(lab_sto) - len(storages) + len(lab_san) - len(sans) + len(lab_sw) - len(pairs)
        if unused > 0:
            log.append(f"[확인] HW 구성도: 엑셀에 없는 스토리지/스위치 라벨 {unused}개는 템플릿 내용 그대로 남음")
        log.append(f"[완료] HW 구성도: TO-BE 서버 {n}그룹 → 슬라이드 {idx + 1}")



# ===========================================================================
# 배포용 엑셀 만들기 (매크로 제거 .xlsx) - 엑셀 파일 내부(XML)를 직접 정리해서 서식·도형·드롭다운 유지
# ===========================================================================
_X = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
      "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006"}
_XM = "{%s}" % _X["m"]
_XR = "{%s}" % _X["r"]


# VBA 함수 GetCPUVersion/GetCPUCoreCount를 대신하는 엑셀 수식 문자열 생성
#   col: CPU 호환 모델 시트에서 가져올 열 (B = 클럭, C = 코어 수)
#   CPU 이름이 정확히 일치하는 행을 먼저 찾고, 없으면 이름이 포함된 행을 찾음. 둘 다 없으면 '-'
def _cpu_formula(cell, col):
    # 원본 VBA 함수(GetCPUVersion/GetCPUCoreCount)처럼 결과를 문자로 돌려줌 (&"")
    #   숫자로 돌려주면 셀마다 다른 표시 형식(예: 0.0"GHz")이 적용돼 GHz가 붙었다 안 붙었다 함
    r = f"'{CPU_SHEET}'!${col}:${col}"
    a = f"'{CPU_SHEET}'!$A:$A"
    return (f'IF({cell}="","-",IFERROR(INDEX({r},MATCH({cell},{a},0))&"",'
            f'IFERROR(INDEX({r},MATCH("*"&{cell}&"*",{a},0))&"","-")))')


# 배포용 엑셀에서 표시 형식에 이 단위가 붙어 있으면 숫자만 보이게 '일반' 서식으로 바꿈
#   (원본 '구매 사양' 시트 K3, K6 처럼 일부 칸에만 0.0"GHz" 서식이 걸려 있어 GHz가 섞여 보였음)
DIST_STRIP_UNITS = ("GHz",)


def _strip_unit_formats(sheet_root, files, styles_part):
    """시트에서 DIST_STRIP_UNITS 단위가 들어간 표시 형식을 쓰는 셀을 '일반' 서식으로 교체. 바꾼 셀 수 반환"""
    from lxml import etree
    st = etree.fromstring(files[styles_part])
    fmts = {nf.get("numFmtId"): nf.get("formatCode", "") for nf in st.iter(_XM + "numFmt")}
    xfs_el = st.find("m:cellXfs", _X)
    xfs = list(xfs_el)
    bad = {i for i, xf in enumerate(xfs)
           if any(u.lower() in fmts.get(xf.get("numFmtId"), "").lower() for u in DIST_STRIP_UNITS)}
    if not bad:
        return 0
    clone, n = {}, 0
    for c in sheet_root.iter(_XM + "c"):
        s = int(c.get("s", "0"))
        if s not in bad:
            continue
        if s not in clone:
            x = deepcopy(xfs[s])
            x.set("numFmtId", "0")
            xfs_el.append(x)
            clone[s] = len(xfs_el) - 1
        c.set("s", str(clone[s]))
        n += 1
    if clone:
        xfs_el.set("count", str(len(xfs_el)))
        files[styles_part] = etree.tostring(st, xml_declaration=True, encoding="UTF-8", standalone=True)
    return n


def make_dist_excel(src, dst):
    """매크로 파일(.xlsm)을 매크로 없는 배포용 .xlsx로 변환. 반환: 변경 내용 요약 문자열 목록"""
    import os
    import posixpath
    import zipfile
    from lxml import etree

    notes = []
    with zipfile.ZipFile(src) as z:
        order = [i.filename for i in z.infolist() if not i.filename.endswith("/")]
        files = {n: z.read(n) for n in order}

    # 압축 안 XML 파일을 읽어 lxml 요소로 반환
    def X(name):
        return etree.fromstring(files[name])

    # 수정한 XML 요소를 다시 바이트로 저장
    def put(name, root):
        files[name] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    # 파일 경로에 대응하는 관계 파일(_rels/*.rels) 경로
    def rels_name(part):
        d, b = posixpath.split(part)
        return posixpath.join(d, "_rels", b + ".rels")

    # 관계 파일의 Target(상대 경로)을 압축 안 전체 경로로 변환
    def target(part, t):
        return t.lstrip("/") if t.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(part), t))

    WB, WBR = "xl/workbook.xml", "xl/_rels/workbook.xml.rels"
    wb, wr = X(WB), X(WBR)
    rels = {r.get("Id"): r for r in wr}
    sheets = wb.find("m:sheets", _X)
    old = list(sheets)
    old_idx = {sh.get("name"): i for i, sh in enumerate(old)}
    # DIST_DROP_SHEET_PREFIX로 시작하는 시트를 목록과 관계에서 제거
    drop = [sh for sh in old if sh.get("name", "").startswith(DIST_DROP_SHEET_PREFIX)]
    for sh in drop:
        rid = sh.get(_XR + "id")
        if rid in rels:
            wr.remove(rels[rid])
        sheets.remove(sh)
    if drop:
        notes.append(f"시트 {len(drop)}개 삭제")
    new_idx = {sh.get("name"): i for i, sh in enumerate(sheets)}
    idx_map = {old_idx[n]: new_idx[n] for n in new_idx}
    dropped = [sh.get("name") for sh in drop]
    # 이름 정의 정리: 매크로용 이름과 삭제한 시트를 가리키는 이름은 제거, 시트 번호(localSheetId)는 새 순서로 변경
    dn = wb.find("m:definedNames", _X)
    if dn is not None:
        for d in list(dn):
            lid = d.get("localSheetId")
            if d.get("xlm") == "1" or any(n in (d.text or "") for n in dropped):
                dn.remove(d)  # 매크로(XLM) 이름, 지운 시트를 가리키는 이름
                continue
            if lid is not None:
                if int(lid) not in idx_map:
                    dn.remove(d)
                    continue
                d.set("localSheetId", str(idx_map[int(lid)]))
    fg = wb.find("m:functionGroups", _X)
    if fg is not None:
        wb.remove(fg)
    for bv in wb.iter(_XM + "workbookView"):
        bv.set("activeTab", "0")
        bv.attrib.pop("firstSheet", None)
    # fullCalcOnLoad: 파일을 열 때 모든 수식을 다시 계산
    cp = wb.find("m:calcPr", _X)
    if cp is not None:
        cp.set("fullCalcOnLoad", "1")
    # 매크로(vbaProject)와 계산 순서(calcChain) 관계 제거
    had_vba = False
    for r in list(wr):
        if r.get("Type").endswith("/vbaProject"):
            had_vba = True
            wr.remove(r)
        elif r.get("Type").endswith("/calcChain"):
            wr.remove(r)
    if had_vba:
        notes.append("매크로 제거")
    put(WB, wb)
    put(WBR, wr)
    rels = {r.get("Id"): r for r in wr}
    sheet_part = {sh.get("name"): target(WB, rels[sh.get(_XR + "id")].get("Target")) for sh in sheets}

    # 시트별: 매크로 버튼 제거, VBA 함수(GetCPU…) 수식 교체, CPU 드롭다운 수식화
    n_btn = n_f = 0
    for name, part in sheet_part.items():
        root = X(part)
        rp = rels_name(part)
        rt = X(rp) if rp in files else None
        rr = {r.get("Id"): r for r in rt} if rt is not None else {}
        ch = ch_r = False  # 바뀐 파일만 다시 저장 (나머지는 원본 그대로)
        # 양식 컨트롤(매크로 버튼) 제거
        for ac in root.findall("mc:AlternateContent", _X):
            if ac.find(".//m:controls", _X) is not None:
                root.remove(ac)
                n_btn += 1
                ch = True
        if rt is not None:
            for r in list(rt):
                if r.get("Type").endswith("/ctrlProp"):
                    rt.remove(r)
                    ch_r = True
            # VML 그림 중 메모가 아닌 것(버튼)은 제거
            ld = root.find("m:legacyDrawing", _X)
            if ld is not None and ld.get(_XR + "id") in rr:
                vml = files.get(target(part, rr[ld.get(_XR + "id")].get("Target")), b"")
                if b'ObjectType="Note"' not in vml:  # 메모(주석)가 아니면 버튼용 → 제거
                    rt.remove(rr[ld.get(_XR + "id")])
                    root.remove(ld)
                    ch = ch_r = True
            # 그리기 개체 중 버튼 형태는 제거. 남는 개체가 없으면 그리기 연결 자체를 제거
            dr = root.find("m:drawing", _X)
            if dr is not None and dr.get(_XR + "id") in rr:
                dp = target(part, rr[dr.get(_XR + "id")].get("Target"))
                droot = X(dp)
                ch_d = False
                for ac in droot.findall("mc:AlternateContent", _X):
                    t = etree.tostring(ac)
                    if b"a14:" in t or b"Button" in t:
                        droot.remove(ac)
                        ch_d = True
                if len(droot) == 0:
                    root.remove(dr)
                    rt.remove(rr[dr.get(_XR + "id")])
                    ch = ch_r = True
                elif ch_d:
                    put(dp, droot)
            if ch_r:
                put(rp, rt)
        # GetCPUVersion(J3) 같은 VBA 함수 수식을 _cpu_formula 수식으로 교체 (배열 수식 속성 제거)
        for f in root.iter(_XM + "f"):
            m = re.match(r"^(?:_xludf\.)?GetCPU(Version|CoreCount)\((\$?[A-Z]+\$?\d+)\)$", (f.text or "").strip(), re.I)
            if m:
                f.text = _cpu_formula(m.group(2), "B" if m.group(1).lower() == "version" else "C")
                for a in ("t", "ref"):
                    f.attrib.pop(a, None)
                f.getparent().attrib.pop("cm", None)
                n_f += 1
                ch = True
        if name == SRC_SHEET and _strip_unit_formats(root, files, "xl/styles.xml"):
            notes.append("CPU 속도 칸 GHz 서식 제거")
            ch = True
        if name == SRC_SHEET:
            # J열 CPU 드롭다운(List_서버명 이름 참조)을 하나로 합치고, F열 서버명으로 목록 이름을 만드는 INDIRECT 수식으로 변경
            dvs = root.find("m:dataValidations", _X)
            if dvs is not None:
                js = [dv for dv in dvs if (dv.findtext("m:formula1", "", _X) or "").startswith("List_")
                      and all(rg.startswith("J") for rg in dv.get("sqref", "").split())]
                if js:
                    rows = [int(n) for dv in js for n in re.findall(r"J(\d+)", dv.get("sqref", ""))]
                    lo, hi = min(rows), max(rows)
                    for dv in js[1:]:
                        dvs.remove(dv)
                    js[0].set("sqref", f"J{lo}:J{hi}")
                    js[0].find("m:formula1", _X).text = (
                        f'INDIRECT("List_"&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(TRIM($F{lo})," ","_"),"-","_"),"+","Plus"))')
                    dvs.set("count", str(len(dvs)))
                    notes.append("CPU 드롭다운 수식화")
                    ch = True
        if ch:
            put(part, root)
    if n_f:
        notes.append(f"CPU 수식 {n_f}개 교체")
    if n_btn:
        notes.append(f"매크로 버튼 {n_btn}곳 제거")

    # 연결이 끊긴 파일 정리 + Content_Types
    # 최상위 관계 파일부터 연결된 파일만 남기고 나머지(삭제한 시트, 매크로 등)는 압축에서 제외
    reach, stack, seen = set(), ["_rels/.rels"], set()
    while stack:
        rp = stack.pop()
        if rp in seen or rp not in files:
            continue
        seen.add(rp)
        reach.add(rp)
        base = posixpath.dirname(posixpath.dirname(rp))
        for r in X(rp):
            if r.get("TargetMode") == "External":
                continue
            t = r.get("Target")
            t = t.lstrip("/") if t.startswith("/") else posixpath.normpath(posixpath.join(base, t))
            reach.add(t)
            stack.append(rels_name(t))
    files = {k: v for k, v in files.items() if k == "[Content_Types].xml" or k in reach}
    ct = X("[Content_Types].xml")
    for o in list(ct.findall("ct:Override", _X)):
        pn = o.get("PartName").lstrip("/")
        if pn not in files:
            ct.remove(o)
        elif pn == WB:
            o.set("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")
    put("[Content_Types].xml", ct)
    # 문서 속성(app.xml)의 시트 이름 목록과 시트 개수에서 삭제한 시트 반영
    if "docProps/app.xml" in files and dropped:
        a = files["docProps/app.xml"].decode("utf-8")
        for n in dropped:
            a = a.replace(f"<vt:lpstr>{n}</vt:lpstr>", "", 1)
        a = re.sub(r"(<vt:lpstr>워크시트</vt:lpstr></vt:variant><vt:variant><vt:i4>)(\d+)",
                   lambda m: m.group(1) + str(len(sheet_part)), a)
        m = re.search(r'<TitlesOfParts><vt:vector size="\d+" baseType="lpstr">(.*?)</vt:vector>', a, re.S)
        if m:
            a = re.sub(r'(<TitlesOfParts><vt:vector size=")\d+',
                       lambda k: k.group(1) + str(m.group(1).count("<vt:lpstr>")), a)
        files["docProps/app.xml"] = a.encode("utf-8")

    # XML 선언은 원본(Excel) 형식으로, [Content_Types].xml 맨 앞, 폴더 항목 없이 압축
    decl_old = b"<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
    decl_new = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
    names = ["[Content_Types].xml"] + [n for n in order if n in files and n != "[Content_Types].xml"]
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            data = files[n]
            if data.startswith(decl_old):
                data = decl_new + data[len(decl_old):].lstrip(b"\r\n")
            z.writestr(n, data)
    return notes


# ===========================================================================
# 실행
# ===========================================================================
# 전체 실행 순서:
#   1) 엑셀을 값 모드(data_only)로 읽음 → 2) 템플릿 PPT 열기 → 3) 제목 업무명 교체
#   4) 표 5종 작성 → 5) 구성도 작성 → 6) PPT 저장 → 7) 배포용 엑셀 저장 (MAKE_DIST_EXCEL)
#   반환: (저장한 PPT 경로, 처리 로그 목록)
def run(excel_path, template_path, out_path=None):
    excel_path, template_path = Path(excel_path), Path(template_path)
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    if SRC_SHEET not in wb.sheetnames:
        raise SystemExit(f"'{SRC_SHEET}' 시트가 없습니다: {excel_path.name}")
    sh = Sheet(wb[SRC_SHEET])
    cpu_db = CpuDB(wb)

    prs = Presentation(str(template_path))
    where = "exe 옆 make_ppt.py" if __import__("os").environ.get("INVESTPPT_EXTERNAL") else ("exe 내장" if getattr(sys, "frozen", False) else "make_ppt.py")
    log = [f"[버전] {SCRIPT_VERSION} / {where}"]
    if sh.off:
        log.append(f"[알림] '{SRC_SHEET}' 시트 앞쪽 빈 열 {sh.off}칸을 건너뛰고 읽음")
    replace_titles(prs, task_name(sh), log)
    fix_nowrap(prs)
    # (표 이름, 표 데이터를 만드는 함수). 표 이름은 SIGNATURES·설정 값의 키와 같음
    builders = [
        ("추진내용", lambda: build_추진내용(sh)),
        ("변경내용", lambda: build_변경내용(sh)),
        ("HW", lambda: build_HW(sh, cpu_db)),
        ("SW", lambda: build_SW(sh)),
        ("비용", lambda: build_비용(sh, cpu_db)),
    ]
    for key, fn in builders:
        try:
            blocks, opts = fn()
            place(prs, key, blocks, opts, log)
        except Exception as e:  # 한 표가 실패해도 나머지는 계속
            log.append(f"[오류] {key}: {e!r}")

    if out_path is None:
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
        out_path = excel_path.with_name(f"{excel_path.stem}_투자심의_{stamp}.pptx")
    try:
        servers, items = arch_servers(sh, cpu_db)
        fill_sw_architecture(prs, servers, log)
        fill_hw_architecture(prs, items, log, servers, read_vms(wb))
    except Exception as e:
        log.append(f"[오류] 구성도: {e!r}")
    # 슬라이드 복제·삭제 후 내부 파일 이름(slideN.xml)을 현재 순서대로 다시 매김
    prs.part.rename_slide_parts([sid.rId for sid in prs.slides._sldIdLst])
    prs.save(str(out_path))
    log.append(f"저장: {out_path}")
    if MAKE_DIST_EXCEL:
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
        dist = Path(out_path).with_name(f"{excel_path.stem}_배포용_{stamp}.xlsx")
        if dist.resolve() == excel_path.resolve():
            dist = dist.with_name(dist.stem + "_new.xlsx")
        try:
            notes = make_dist_excel(str(excel_path), str(dist))
            log.append(f"저장: {dist}" + (f" ({', '.join(notes)})" if notes else ""))
        except Exception as e:
            log.append(f"[오류] 배포용 엑셀: {e!r}")
    return str(out_path), log


# 명령줄 인수가 2개 이상이면 (엑셀, 템플릿[, 출력]) 경로로 바로 실행하고 로그를 출력
# 인수가 없으면 파일 선택 창으로 엑셀과 템플릿을 고른 뒤 실행하고 결과를 메시지 창으로 표시
def app_dir():
    """exe로 실행하면 exe가 있는 폴더, 파이썬으로 실행하면 make_ppt.py가 있는 폴더"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def find_template():
    """TEMPLATE_NAME 파일 경로 반환. 우선순위: 실행 폴더의 파일 → exe 안에 포함된 파일. 없으면 None"""
    local = app_dir() / TEMPLATE_NAME
    if local.is_file():
        return local
    bundled = Path(getattr(sys, "_MEIPASS", app_dir())) / TEMPLATE_NAME  # PyInstaller가 압축을 푼 임시 폴더
    if bundled.is_file():
        return bundled
    return None


# 실행 방법
#   명령줄: make_ppt.exe 엑셀 [템플릿 [출력.pptx]]  (템플릿을 생략하면 find_template 결과 사용)
#   더블클릭: 엑셀 선택 창만 표시. 템플릿을 찾지 못한 경우에만 템플릿 선택 창 추가 표시
def main():
    if len(sys.argv) >= 2:
        tp = sys.argv[2] if len(sys.argv) > 2 else find_template()
        if tp is None:
            raise SystemExit(f"템플릿을 찾을 수 없습니다: {TEMPLATE_NAME}")
        out, log = run(sys.argv[1], tp, sys.argv[3] if len(sys.argv) > 3 else None)
        print("\n".join(log))
        return
    import tkinter as tk
    from tkinter import filedialog, messagebox
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)  # 선택 창·메시지 창이 다른 창 뒤에 가려지지 않도록 맨 앞에 표시
    root.update()  # 숨긴 기본 창을 먼저 화면 처리해야 Windows에서 선택 창이 바로 나타남
    root.lift()
    root.focus_force()
    xl = filedialog.askopenfilename(parent=root, title="구매 사양 엑셀 선택",
                                    filetypes=[("Excel", "*.xlsx *.xlsm"), ("All", "*.*")])
    if not xl:
        return
    tp = find_template()
    if tp is None:
        tp = filedialog.askopenfilename(parent=root, title="PPT 템플릿 선택", filetypes=[("PowerPoint", "*.pptx")])
        if not tp:
            return
    try:
        out, log = run(xl, tp)
        messagebox.showinfo("투자심의 PPT 생성 완료", "\n".join(log), parent=root)
    except BaseException as e:  # SystemExit(시트 없음 등)도 메시지로 표시
        messagebox.showerror("오류", str(e) or repr(e), parent=root)


def _report_crash():
    """main() 밖으로 나온 오류를 실행 폴더의 make_ppt_오류.txt 에 기록하고 메시지 창으로 표시
    (exe는 콘솔 창 없이 실행되므로, 이 처리가 없으면 오류가 나도 화면에 아무것도 나타나지 않음)"""
    import traceback
    msg = traceback.format_exc()
    log_path = app_dir() / "make_ppt_오류.txt"
    try:
        log_path.write_text(msg, encoding="utf-8")
    except OSError:
        log_path = None
    try:
        import tkinter as tk
        from tkinter import messagebox
        r = tk.Tk()
        r.withdraw()
        r.attributes("-topmost", True)
        messagebox.showerror("make_ppt 오류", msg[-1500:] + (f"\n\n기록 파일: {log_path}" if log_path else ""), parent=r)
    except Exception:
        print(msg, file=sys.stderr)


def _external_script():
    """exe 옆에 make_ppt.py 가 있으면 그 경로를 반환 (스크립트만 고쳤을 때 다시 빌드하지 않아도 되도록)
    exe 안에 들어 있는 라이브러리(python-pptx, openpyxl, lxml, tkinter)만 쓸 수 있음"""
    import os
    if not getattr(sys, "frozen", False) or os.environ.get("INVESTPPT_EXTERNAL"):
        return None
    p = app_dir() / "make_ppt.py"
    return p if p.is_file() else None


if __name__ == "__main__":
    try:
        ext = _external_script()
        if ext:
            import os
            import runpy
            os.environ["INVESTPPT_EXTERNAL"] = "1"  # 바깥 스크립트가 또 자기 자신을 찾지 않도록 표시
            runpy.run_path(str(ext), run_name="__main__")
        else:
            main()
    except SystemExit as e:
        if e.code not in (None, 0):
            _report_crash()
    except BaseException:
        _report_crash()
