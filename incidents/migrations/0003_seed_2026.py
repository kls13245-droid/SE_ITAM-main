"""monday 주간보고(WW46)에 있던 2026년 장애·유지보수 건과 건수를 처음 한 번 넣는다.

이미 같은 건(유형·제목)이 있으면 건너뛰고, 건수 보정값도 이미 있으면 그대로 둔다.
"""
from django.db import migrations


def forward(apps, schema_editor):
    from incidents.seed_2026 import load
    load(apps.get_model('incidents', 'Incident'), apps.get_model('incidents', 'IncidentLog'),
         apps.get_model('incidents', 'ReportBaseline'))


class Migration(migrations.Migration):
    dependencies = [('incidents', '0002_count_adjustments')]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
