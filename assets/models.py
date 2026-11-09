from django.db import models
from simple_history.models import HistoricalRecords
class Campus(models.Model):
    """Level 1: 사업장 (예: 기흥, 화성, 평택)"""
    name = models.CharField(max_length=100, verbose_name="캠퍼스 이름")

    def __str__(self):
        return self.name

class Building(models.Model):
    """Level 2: 건물/동 (예: S1, NRD-K)"""
    campus = models.ForeignKey(Campus, on_delete=models.CASCADE, related_name='buildings', verbose_name="소속 캠퍼스")
    name = models.CharField(max_length=100, verbose_name="건물/동 이름")

    def __str__(self):
        return f"[{self.campus.name}] {self.name}"

class Rack(models.Model):
    """Level 3: 랙 단위 정보"""
    building = models.ForeignKey(Building, on_delete=models.CASCADE, related_name='racks', verbose_name="소속 건물")
    name = models.CharField(max_length=50, verbose_name="랙 이름 (예: NRD-K-RACK-01)")
    location = models.CharField(max_length=100, blank=True, verbose_name="상세 위치 (예: Row A - 01)")
    total_u_space = models.IntegerField(default=42, verbose_name="총 U 높이")

    def __str__(self):
        return f"{self.building.name} - {self.name}"

class ServerAsset(models.Model):
    """Level 4: 서버 본체 및 개별 장비 정보"""
    STATUS_CHOICES = [
        ('WAIT', '입고 대기'),
        ('SETUP', '셋업 진행'),
        ('OPER', '납품/운영'),
        ('MAINT', '장애/수리'),
        ('IDLE', '유휴/폐기'),
    ]

    rack = models.ForeignKey(Rack, on_delete=models.SET_NULL, null=True, blank=True, related_name='servers', verbose_name="실장된 랙")
    
    # 프로토타입에 맞춘 추가 필드들
    hostname = models.CharField(max_length=100, blank=True, verbose_name="호스트네임 (예: kr-gh-nrdk-db01)")
    model_name = models.CharField(max_length=100, verbose_name="서버 모델명")
    
    start_u = models.IntegerField(null=True, blank=True, verbose_name="시작 위치 (U)")
    size_u = models.IntegerField(default=1, verbose_name="차지하는 크기 (U)")
    
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='WAIT', verbose_name="현재 상태")
    setup_year = models.CharField(max_length=4, blank=True, verbose_name="도입년도")
    description = models.TextField(blank=True, verbose_name="자산 용도/설명")
    
    # 상세 제원 (CPU, RAM, GPU, IP 등은 JSON으로 유연하게 저장)
    os_version = models.CharField(max_length=100, blank=True, verbose_name="OS 버전")
    
    specs = models.JSONField(default=dict, blank=True, verbose_name="상세 제원 (JSON)")
    history = HistoricalRecords()
    def __str__(self):
        return f"{self.hostname or self.model_name} ({self.rack.name if self.rack else '미실장'})"


class FieldAsset(models.Model):
    """고객사 현장에 설치된 장비 (PM 점검 대상). 랙 실장도와는 따로 관리한다.

    지금은 monday 'SE파트 - PM 현황' 보드에서 가져온 스냅샷을 담는다.
    상태·PM 상태 등은 monday의 표기를 그대로 저장한다.
    """
    HEALTH_PARTS = ('cpu', 'memory', 'network', 'disk', 'fans', 'cache_battery')

    monday_item_id = models.CharField(max_length=30, unique=True, null=True, blank=True, verbose_name="monday 항목 ID")
    hostname = models.CharField(max_length=150, verbose_name="호스트명")
    site_group = models.CharField(max_length=100, blank=True, verbose_name="현장/제품 그룹")
    complex = models.CharField(max_length=50, blank=True, verbose_name="단지")
    product = models.CharField(max_length=50, blank=True, verbose_name="제품명")
    status = models.CharField(max_length=50, blank=True, verbose_name="상태")
    model_name = models.CharField(max_length=100, blank=True, verbose_name="모델")
    serial_number = models.CharField(max_length=100, blank=True, verbose_name="S/N")
    ipmi_ip = models.CharField(max_length=100, blank=True, verbose_name="IPMI IP")
    public_ip = models.CharField(max_length=200, blank=True, verbose_name="Public IP")
    private_ip = models.CharField(max_length=200, blank=True, verbose_name="Private IP")
    ipmi_status = models.CharField(max_length=50, blank=True, verbose_name="IPMI 상태")
    pm_date = models.DateField(null=True, blank=True, verbose_name="PM 날짜")
    pm_status = models.CharField(max_length=50, blank=True, verbose_name="PM 상태")
    warranty_end = models.DateField(null=True, blank=True, verbose_name="워런티 종료")
    health = models.JSONField(default=dict, blank=True, verbose_name="부품 상태")
    note = models.TextField(blank=True, verbose_name="비고")
    imported_at = models.DateTimeField(null=True, blank=True, verbose_name="마지막 가져온 시각")
    # ITAM에서 직접 고친 장비는 monday CSV를 다시 가져와도 덮어쓰지 않는다
    locally_modified = models.BooleanField(default=False, verbose_name="ITAM에서 수정됨")
    history = HistoricalRecords()

    class Meta:
        ordering = ['complex', 'site_group', 'hostname']
        verbose_name = verbose_name_plural = "현장 장비 (PM)"

    def __str__(self):
        return f"{self.hostname} ({self.site_group})"


class PMRecord(models.Model):
    """현장 장비 PM(정기 점검) 기록. 점검할 때마다 한 건씩 쌓인다.

    가장 최근 기록의 날짜·결과·부품 상태가 장비 목록의 PM 정보로 반영된다.
    """
    PM_STATUSES = ('완료', '확인 필요', '미사용')

    asset = models.ForeignKey(FieldAsset, on_delete=models.CASCADE, related_name='pm_records', verbose_name="장비")
    pm_date = models.DateField(verbose_name="점검일")
    pm_status = models.CharField(max_length=20, default='완료', verbose_name="점검 결과")
    health = models.JSONField(default=dict, blank=True, verbose_name="부품 상태")
    worker = models.CharField(max_length=100, blank=True, verbose_name="작업자")
    note = models.TextField(blank=True, verbose_name="작업 내용")
    created_by = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, blank=True, verbose_name="입력자")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="입력 시각")

    class Meta:
        ordering = ['-pm_date', '-id']
        verbose_name = verbose_name_plural = "PM 점검 기록"

    def __str__(self):
        return f"{self.asset.hostname} {self.pm_date} {self.pm_status}"
