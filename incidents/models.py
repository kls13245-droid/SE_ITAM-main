from django.conf import settings
from django.db import models
from simple_history.models import HistoricalRecords


class Incident(models.Model):
    """장애·PM 후속 조치·유지보수 한 건. 주간보고의 '[장애] 제목 | 상태' 한 줄이 된다."""
    KIND_CHOICES = [('FAULT', '장애'), ('PM', 'PM (후속 조치)'), ('MAINT', '유지 보수')]
    # 주간보고 줄 앞에 붙는 꼬리표
    KIND_TAG = {'FAULT': '장애', 'PM': 'PM', 'MAINT': '유지보수'}
    STATUS_CHOICES = [('IN_PROGRESS', '진행 중'), ('WAIT', '대기'), ('HOLD', '보류'), ('DONE', '완료')]

    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default='FAULT', verbose_name="유형")
    title = models.CharField(max_length=200, verbose_name="제목")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='IN_PROGRESS', verbose_name="상태")
    occurred_on = models.DateField(verbose_name="발생일")
    done_on = models.DateField(null=True, blank=True, verbose_name="완료일")
    asset_name = models.CharField(max_length=200, blank=True, verbose_name="관련 장비")
    field_asset = models.ForeignKey('assets.FieldAsset', null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='incidents', verbose_name="연결된 현장 장비")
    hide_in_report = models.BooleanField(default=False, verbose_name="주간보고에서 빼기")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='+', verbose_name="작성자")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="작성 시각")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="수정 시각")
    history = HistoricalRecords()

    class Meta:
        ordering = ['-occurred_on', '-id']
        verbose_name = verbose_name_plural = "장애·유지보수 건"

    def __str__(self):
        return f"[{self.KIND_TAG.get(self.kind, self.kind)}] {self.title} | {self.get_status_display()}"


class IncidentLog(models.Model):
    """진행 기록 한 줄. 주간보고에서 건 아래 들여쓴 줄이 된다."""
    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name='logs', verbose_name="건")
    date = models.DateField(null=True, blank=True, verbose_name="날짜")
    text = models.TextField(verbose_name="내용")
    level = models.PositiveSmallIntegerField(default=1, verbose_name="들여쓰기 (1~3)")
    order = models.PositiveIntegerField(default=0, verbose_name="순서")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='+', verbose_name="입력자")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="입력 시각")
    history = HistoricalRecords()

    class Meta:
        ordering = ['order', 'id']
        verbose_name = verbose_name_plural = "진행 기록"

    def __str__(self):
        return f"{self.date or ''} {self.text[:40]}"


class ReportBaseline(models.Model):
    """건수 표 보정값. ITAM 건으로 센 숫자에 더한다 (ITAM을 쓰기 전 건, 표를 직접 고친 차이).

    표에서 숫자를 직접 고치면 '고친 값 - ITAM 건으로 센 값'이 여기 저장된다.
    그래서 나중에 건이 추가·완료되어도 표가 그만큼 따라 움직인다.
    """
    year = models.PositiveIntegerField(verbose_name="연도")
    kind = models.CharField(max_length=10, choices=Incident.KIND_CHOICES, verbose_name="유형")
    done_before = models.IntegerField(default=0, verbose_name="완료 보정 (ITAM 이전 완료 건수 등)")
    adj_in_progress = models.IntegerField(default=0, verbose_name="진행 중 보정")
    adj_waiting = models.IntegerField(default=0, verbose_name="보류 및 대기 보정")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="수정 시각")

    class Meta:
        unique_together = [('year', 'kind')]
        ordering = ['-year', 'kind']
        verbose_name = verbose_name_plural = "이전 완료 건수"

    def __str__(self):
        return f"{self.year} {self.get_kind_display()}: {self.done_before}"

