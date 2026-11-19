from django.db import models
from simple_history.models import HistoricalRecords


# ---------------------------------------------------------------------------
# 기준정보: 심의 매크로 엑셀의 '이름 관리자' 항목을 옮겨 온 것
# ---------------------------------------------------------------------------
class PartCode(models.Model):
    """품목별 CIS 코드 (이름 관리자의 code_* 항목, DB 시트 G·H열)"""
    name = models.CharField(max_length=150, unique=True, verbose_name="품목")
    key = models.CharField(max_length=150, blank=True, verbose_name="이름 관리자 이름 (예: code_R660)")
    cis_code = models.CharField(max_length=50, blank=True, verbose_name="CIS 코드")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="수정 시각")
    history = HistoricalRecords()

    class Meta:
        ordering = ['name']
        verbose_name = verbose_name_plural = "품목 CIS 코드"

    def __str__(self):
        return f"{self.name} ({self.cis_code or '코드 없음'})"


class MasterList(models.Model):
    """선택 목록 (이름 관리자의 범위 이름. 예: 제조사_서버, 서버모델_DELL, OS, List_R760)"""
    name = models.CharField(max_length=150, unique=True, verbose_name="이름")
    group = models.CharField(max_length=50, blank=True, verbose_name="분류")
    values = models.JSONField(default=list, blank=True, verbose_name="값 목록")
    source = models.CharField(max_length=200, blank=True, verbose_name="원본 범위 (예: DB!$B$2:$B$3)")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="수정 시각")
    history = HistoricalRecords()

    class Meta:
        ordering = ['group', 'name']
        verbose_name = verbose_name_plural = "선택 목록"

    def __str__(self):
        return self.name


class CpuSpec(models.Model):
    """CPU 호환 모델 시트 (CPU 이름 → 클럭, 코어 수)"""
    name = models.CharField(max_length=150, unique=True, verbose_name="CPU")
    clock = models.CharField(max_length=30, blank=True, verbose_name="클럭 (GHz)")
    cores = models.CharField(max_length=30, blank=True, verbose_name="코어 수")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="수정 시각")
    history = HistoricalRecords()

    class Meta:
        ordering = ['name']
        verbose_name = verbose_name_plural = "CPU 사양"

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# 심의건과 산출물
# ---------------------------------------------------------------------------
class ReviewCase(models.Model):
    # DB에는 영문 코드, 화면에는 한글 (서버 장비 표의 WAIT/'입고 대기'와 같은 방식)
    STATUS_CHOICES = [
        ('DRAFT', '작성중'),      # 구매 사양 항목 입력 중
        ('REVIEW', '심의중'),     # PPT를 만들어 심의에 올림
        ('APPROVED', '승인'),     # 심의 통과
        ('PURCHASE', '구매중'),   # 발주 진행
        ('RECEIVED', '입고완료'), # 장비가 ITAMS에 등록됨
        ('REJECTED', '반려'),     # 심의에서 떨어짐. 다시 작성중으로 돌릴 수 있음
    ]
    # 현황판의 3구분 (대기 / 진행 / 완료). 반려는 다시 작성해서 올려야 하므로 '대기'로 센다
    STAGE_CHOICES = [('WAIT', '대기'), ('PROGRESS', '진행'), ('DONE', '완료')]
    STATUS_STAGE = {
        'DRAFT': 'WAIT', 'REJECTED': 'WAIT',
        'REVIEW': 'PROGRESS', 'APPROVED': 'PROGRESS', 'PURCHASE': 'PROGRESS',
        'RECEIVED': 'DONE',
    }

    title = models.CharField(max_length=200, verbose_name="업무명")
    line = models.CharField(max_length=100, blank=True, verbose_name="라인명")
    product = models.CharField(max_length=100, blank=True, verbose_name="제품")
    year = models.CharField(max_length=4, blank=True, verbose_name="심의 연도")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='DRAFT', verbose_name="상태")
    # 구매 사양을 어디서 읽어 PPT를 만들지: 화면에서 입력한 표(FORM) 또는 올린 엑셀(EXCEL)
    INPUT_CHOICES = [('FORM', '화면 입력'), ('EXCEL', '엑셀 올리기')]
    input_mode = models.CharField(max_length=5, choices=INPUT_CHOICES, default='FORM', verbose_name="구매 사양 입력 방식")
    note = models.TextField(blank=True, verbose_name="메모")
    source_excel = models.FileField(upload_to='reviews/source/', blank=True, verbose_name="구매 사양 엑셀")
    source_name = models.CharField(max_length=255, blank=True, verbose_name="올린 엑셀 파일 이름")
    source_uploaded_at = models.DateTimeField(null=True, blank=True, verbose_name="엑셀 올린 시각")
    created_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='review_cases', verbose_name="작성자")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="작성 시각")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="수정 시각")
    history = HistoricalRecords()

    class Meta:
        ordering = ['-updated_at']
        verbose_name = verbose_name_plural = "심의건"

    def __str__(self):
        return self.title

    @property
    def stage(self):
        return self.STATUS_STAGE.get(self.status, 'WAIT')


class SpecItem(models.Model):
    """화면에서 입력한 구매 사양 한 줄 (엑셀 '구매 사양' 시트의 장비·라이선스 한 행)

    공통 칸(유형·장비명·제조사·모델·수량)은 열로 두고, 구역마다 다른 칸은 data(JSON)에 둔다.
      서버    : os, cpu, cpu_qty, mem, mem_qty,
                disks [{type, size, unit, qty}], hbas·nics·gpus [{model, qty}] (필요한 만큼. 예전 disk1·hba 등 고정 칸은 읽을 때 바꿈)
                + SW-수량산정: vm_win, vm_linux, core, sw {제품 키: 수량 (직접 입력하는 제품)}
      스토리지: disks [{type, size, count, ratio}]
      ETC·NW  : spec
      License : version, edition, basis (SW-수량산정 제품 키. 비우면 수량 직접 입력)
    """
    BLOCK_CHOICES = [('server', '서버'), ('storage', '스토리지'), ('etc', 'ETC'), ('nw', 'NW'), ('license', 'License')]

    case = models.ForeignKey(ReviewCase, on_delete=models.CASCADE, related_name='spec_items', verbose_name="심의건")
    block = models.CharField(max_length=10, choices=BLOCK_CHOICES, verbose_name="구역")
    order = models.PositiveIntegerField(default=0, verbose_name="순서")
    kind = models.CharField(max_length=50, blank=True, verbose_name="유형")
    name = models.CharField(max_length=100, blank=True, verbose_name="장비명")
    usage = models.CharField(max_length=100, blank=True, verbose_name="용도 (비우면 자동)")
    maker = models.CharField(max_length=50, blank=True, verbose_name="제조사")
    model = models.CharField(max_length=100, blank=True, verbose_name="모델")
    qty = models.FloatField(null=True, blank=True, verbose_name="수량")
    note = models.CharField(max_length=255, blank=True, verbose_name="비고")
    data = models.JSONField(default=dict, blank=True, verbose_name="구역별 사양")
    history = HistoricalRecords()

    class Meta:
        ordering = ['case', 'order', 'id']
        verbose_name = verbose_name_plural = "구매 사양 줄"

    def __str__(self):
        return f"{self.get_block_display()} {self.name or self.model}"


class ReviewOutput(models.Model):
    """'PPT 만들기'를 한 번 누를 때마다 남는 결과 (PPT, 배포용 엑셀, 실행 기록)"""
    case = models.ForeignKey(ReviewCase, on_delete=models.CASCADE, related_name='outputs', verbose_name="심의건")
    pptx = models.FileField(upload_to='reviews/output/', blank=True, verbose_name="PPT")
    xlsx = models.FileField(upload_to='reviews/output/', blank=True, verbose_name="배포용 엑셀")
    log = models.TextField(blank=True, verbose_name="실행 기록")
    ok = models.BooleanField(default=True, verbose_name="성공")
    created_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='review_outputs', verbose_name="실행자")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="만든 시각")

    class Meta:
        ordering = ['-created_at']
        verbose_name = verbose_name_plural = "심의자료 산출물"


class PptTemplate(models.Model):
    """PPT 템플릿. 가장 최근에 올린 '사용' 템플릿 하나로 PPT를 만든다"""
    name = models.CharField(max_length=255, verbose_name="파일 이름")
    file = models.FileField(upload_to='reviews/template/', verbose_name="템플릿 파일")
    is_active = models.BooleanField(default=True, verbose_name="사용")
    uploaded_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, verbose_name="올린 사람")
    uploaded_at = models.DateTimeField(auto_now_add=True, verbose_name="올린 시각")

    class Meta:
        ordering = ['-uploaded_at']
        verbose_name = verbose_name_plural = "PPT 템플릿"

    def __str__(self):
        return self.name
