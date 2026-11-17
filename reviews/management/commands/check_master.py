"""기준정보 검증: python manage.py check_master [--fix] [--csv 파일]

  --fix : 공백·빈 값·같은 목록 안의 중복 값만 정리한다 (변경 이력이 남음)
  --csv : 문제 목록을 CSV(엑셀에서 바로 열림)로 저장한다
"""
import csv
from collections import Counter

from django.core.management.base import BaseCommand

from reviews import master_check

LEVEL = {'fix': '정리 가능', 'ask': '확인 필요', 'info': '참고'}


class Command(BaseCommand):
    help = '기준정보(선택 목록·CPU 사양·품목 CIS 코드)를 검증하고, --fix면 공백·중복을 정리한다'

    def add_arguments(self, parser):
        parser.add_argument('--fix', action='store_true', help='공백·빈 값·중복 정리')
        parser.add_argument('--csv', help='문제 목록을 저장할 CSV 파일 경로')

    def handle(self, *args, **opts):
        if opts['fix']:
            changes = master_check.apply_safe()
            for c in changes:
                self.stdout.write(f"[정리] {c['area']} {c['target']}: {c['before']} → {c['after']}")
            self.stdout.write(self.style.SUCCESS(f'정리 {len(changes)}건'))
        issues = master_check.check()
        for i in issues:
            self.stdout.write(f"[{LEVEL[i['level']]}] {i['area']} | {i['target']} | {i['problem']}"
                              + (f" → {i['suggestion']}" if i['suggestion'] else ''))
        counts = Counter(LEVEL[i['level']] for i in issues)
        self.stdout.write(self.style.SUCCESS(', '.join(f'{k} {v}건' for k, v in counts.items()) or '문제 없음'))
        if opts['csv']:
            with open(opts['csv'], 'w', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                w.writerow(['구분', '영역', '대상', '문제', '수정안'])
                for i in issues:
                    w.writerow([LEVEL[i['level']], i['area'], i['target'], i['problem'], i['suggestion']])
            self.stdout.write(f"CSV 저장: {opts['csv']}")
