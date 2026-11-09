"""현장 장비(PM)를 랙 실장도에 임시로 자동 배치한다.

    python manage.py place_field_assets --dry-run   # 어떻게 배치될지 확인만
    python manage.py place_field_assets             # 실제 배치

캠퍼스=단지, 건물=현장, 랙='{제품}-RACK-NN'(42U, U1부터 차례로).
이미 배치한 장비는 건너뛰므로 다시 실행해도 중복되지 않는다.
배치 후 실제 위치는 화면에서 드래그해 옮기면 된다.
"""
from django.core.management.base import BaseCommand

from assets.services import place_field_assets


class Command(BaseCommand):
    help = "현장 장비를 단지/현장/제품별 랙에 임시로 자동 배치합니다."

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='저장하지 않고 결과만 출력')

    def handle(self, dry_run=False, **opts):
        r = place_field_assets(dry_run=dry_run)
        prefix = '[확인만] ' if dry_run else ''
        self.stdout.write(self.style.SUCCESS(
            f"{prefix}배치 {r['placed']}대, 새 랙 {r['racks_created']}개 (이미 배치돼 건너뛴 장비 {r['skipped_already']}대)"))
        if r['renamed']:
            self.stdout.write(self.style.WARNING(f"같은 현장에 같은 이름이 있어 번호를 붙인 장비 {len(r['renamed'])}대:"))
            for x in r['renamed']:
                self.stdout.write(f"  {x}")
        if r['ip_fixed']:
            self.stdout.write(self.style.WARNING(f"IP 형식이 맞지 않아 비워 두고 설명란에 원래 값을 남긴 항목 {len(r['ip_fixed'])}건:"))
            for x in r['ip_fixed']:
                self.stdout.write(f"  {x}")
        self.stdout.write(f"사용한 랙 {len(r['racks'])}개:")
        for x in r['racks']:
            self.stdout.write(f"  {x}")
