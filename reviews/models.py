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

    class Meta:
        ordering = ['name']
        verbose_name = verbose_name_plural = "CPU 사양"

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# 심의건과 산출물
# ---------------------------------------------------------------------------
class ReviewCase(models.Model):
    STATUS_CHOICES = [('작성중', '작성중'), ('심의중', '심의중'), ('완료', '완료')]

    title = models.CharField(max_length=200, verbose_name="업무명")
    line = models.CharField(max_length=100, blank=True, verbose_name="라인명")
    product = models.CharField(max_length=100, blank=True, verbose_name="제품")
    year = models.CharField(max_length=4, blank=True, verbose_name="심의 연도")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='작성중', verbose_name="상태")
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
