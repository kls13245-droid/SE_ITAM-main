"""monday 'WW46 SE파트 주간보고'의 [2026년 장애 및 유지보수] 기존 건을 넣는다.

보통은 python manage.py migrate 때 자동으로 들어간다 (incidents 마이그레이션 0003).
수동으로 다시 넣을 때: python manage.py shell < scripts/seed_incidents_2026.py  (있는 건은 건너뜀)
"""
from django.db import transaction

from incidents.models import Incident, IncidentLog, ReportBaseline
from incidents.seed_2026 import load

with transaction.atomic():
    added, skipped = load(Incident, IncidentLog, ReportBaseline)
print(f'장애·유지보수 {added}건 추가, {skipped}건은 이미 있어 건너뜀')
