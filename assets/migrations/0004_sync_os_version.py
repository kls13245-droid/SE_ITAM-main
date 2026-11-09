"""OS 버전이 specs['os_version']과 os_version 필드에 따로 저장되던 것을 하나로 맞춘다.

화면에서 입력한 값(specs)을 우선하고, 없으면 기존 필드 값을 specs에도 채운다.
"""
from django.db import migrations


def sync(apps, schema_editor):
    ServerAsset = apps.get_model('assets', 'ServerAsset')
    for s in ServerAsset.objects.all():
        specs = s.specs if isinstance(s.specs, dict) else {}
        value = (specs.get('os_version') or s.os_version or '').strip()
        if value != s.os_version or specs.get('os_version') != value:
            specs['os_version'] = value
            ServerAsset.objects.filter(pk=s.pk).update(os_version=value, specs=specs)


class Migration(migrations.Migration):
    dependencies = [('assets', '0003_historicalserverasset')]
    operations = [migrations.RunPython(sync, migrations.RunPython.noop)]
