"""monday 'SE파트 - PM 현황' CSV를 현장 장비로 가져온다.

사용법:
    python manage.py import_field_assets monday_PM현황_20261109.csv
    python manage.py import_field_assets 파일.csv --dry-run   # 저장하지 않고 결과만 확인
"""
from django.core.management.base import BaseCommand, CommandError

from assets.services import ValidationError, import_field_assets


class Command(BaseCommand):
    help = "monday PM 현황 CSV를 현장 장비(FieldAsset)로 가져옵니다. monday ID 기준으로 갱신합니다."

    def add_arguments(self, parser):
        parser.add_argument('csv_path')
        parser.add_argument('--dry-run', action='store_true', help='저장하지 않고 결과만 출력')

    def handle(self, csv_path, dry_run=False, **opts):
        try:
            with open(csv_path, 'rb') as f:
                result = import_field_assets(f.read(), dry_run=dry_run)
        except (OSError, ValidationError) as e:
            raise CommandError(str(e))
        prefix = '[확인만] ' if dry_run else ''
        self.stdout.write(self.style.SUCCESS(
            f"{prefix}전체 {result['total']}행: 신규 {result['created']}, 갱신 {result['updated']}, 오류 {len(result['errors'])}"))
        for e in result['errors']:
            self.stdout.write(self.style.WARNING(f"  {e['line']}행 {e['hostname']}: {e['error']}"))
