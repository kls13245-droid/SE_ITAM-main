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
    monday_title = models.CharField(max_length=300, blank=True, verbose_name="monday에서 가져온 원래 줄")
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
    level = models.PositiveSmallIntegerField(default=1, verbose_name="들여쓰기 (1~2)")
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
    """ITAM을 쓰기 전에 이미 끝난 건수. 주간보고 표의 총 건수·완료에 더한다."""
    year = models.PositiveIntegerField(verbose_name="연도")
    kind = models.CharField(max_length=10, choices=Incident.KIND_CHOICES, verbose_name="유형")
    done_before = models.PositiveIntegerField(default=0, verbose_name="ITAM 이전 완료 건수")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="수정 시각")

    class Meta:
        unique_together = [('year', 'kind')]
        ordering = ['-year', 'kind']
        verbose_name = verbose_name_plural = "이전 완료 건수"

    def __str__(self):
        return f"{self.year} {self.get_kind_display()}: {self.done_before}"


class ReportSync(models.Model):
    """monday 주간보고에 반영한 기록"""
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="반영 시각")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='+', verbose_name="반영한 사람")
    item_id = models.CharField(max_length=30, blank=True, verbose_name="monday 아이템 ID")
    item_name = models.CharField(max_length=300, blank=True, verbose_name="monday 아이템")
    doc_id = models.CharField(max_length=30, blank=True, verbose_name="문서 ID")
    doc_name = models.CharField(max_length=300, blank=True, verbose_name="문서")
    ok = models.BooleanField(default=False, verbose_name="성공")
    message = models.TextField(blank=True, verbose_name="결과")
    created_blocks = models.PositiveIntegerField(default=0, verbose_name="새로 쓴 블록 수")
    deleted_blocks = models.PositiveIntegerField(default=0, verbose_name="지운 블록 수")

    class Meta:
        ordering = ['-created_at', '-id']
        verbose_name = verbose_name_plural = "주간보고 반영 기록"

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.item_name} ({'성공' if self.ok else '실패'})"
