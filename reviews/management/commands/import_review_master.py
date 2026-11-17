from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from assets.services import ValidationError
from reviews.services import import_master


class Command(BaseCommand):
    help = "투자심의 매크로 엑셀(.xlsm)의 이름 관리자 내용을 기준정보에 합칩니다 (DB가 기준: 없는 것만 추가, 빈칸만 채움)."

    def add_arguments(self, parser):
        parser.add_argument('path', help='심의 매크로 엑셀 경로 (.xlsm/.xlsx)')
        parser.add_argument('--dry-run', action='store_true', help='DB를 바꾸지 않고 바뀔 내용만 보여 줌')

    def handle(self, path, dry_run=False, **options):
        p = Path(path)
        if not p.is_file():
            raise CommandError(f'파일이 없습니다: {p}')
        try:
            result = import_master(p.read_bytes(), dry_run=dry_run)
        except ValidationError as e:
            raise CommandError(str(e))
        labels = {'codes': '품목 CIS 코드', 'lists': '선택 목록', 'cpus': 'CPU 사양'}
        for key, label in labels.items():
            r = result[key]
            self.stdout.write(f"{label}: 엑셀 {r['total']} / 추가 {r['added']} / 빈칸 채움 {r['filled']} / 예전에 지운 값이라 건너뜀 {r['skipped']}")
        if dry_run:
            missing = result.get('missing_cis') or []
            if missing:
                self.stdout.write(f"CIS 코드가 비었거나 덜 적힌 품목 {len(missing)}개: {', '.join(missing)}")
            self.stdout.write(self.style.WARNING('--dry-run: DB는 바뀌지 않았습니다.'))
        else:
            self.stdout.write(self.style.SUCCESS('기준정보에 합쳤습니다. 이미 있는 값은 바꾸지 않았습니다.'))
