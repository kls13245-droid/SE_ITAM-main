"""기준정보 1차 정리 반영: python manage.py apply_master_fixes [--dry-run]"""
from django.core.management.base import BaseCommand

from reviews import master_fixes


class Command(BaseCommand):
    help = '2026-11-17 기준정보 검증에서 정한 수정안(누락 서버 추가, CPU 이름 통일, 오타 수정 등)을 반영한다'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='저장하지 않고 바뀔 내용만 보여 준다')

    def handle(self, *args, **opts):
        changes = master_fixes.apply(dry_run=opts['dry_run'])
        for c in changes:
            self.stdout.write(f"[{c['area']}] {c['target']}: {c['before']} → {c['after']}")
        word = '바뀔 내용' if opts['dry_run'] else '반영'
        self.stdout.write(self.style.SUCCESS(f'{word} {len(changes)}건'))
        if not opts['dry_run'] and changes:
            self.stdout.write('\n원본 매크로 엑셀에도 같이 고칠 것:')
            for where, what in master_fixes.EXCEL_TODO:
                self.stdout.write(f'  - {where}: {what}')
