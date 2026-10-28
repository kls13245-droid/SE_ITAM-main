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
