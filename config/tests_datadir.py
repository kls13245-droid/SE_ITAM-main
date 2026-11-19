import os
import subprocess
import sys
import tempfile
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

ROOT = Path(settings.BASE_DIR)


def run_settings(env_extra):
    """새 파이썬에서 settings를 읽어 DB·업로드 경로를 출력 (지금 테스트 설정에 영향 없게)"""
    code = ("import django,os;os.environ['DJANGO_SETTINGS_MODULE']='config.settings';"
            "from django.conf import settings as s;print(s.DATABASES['default']['NAME']);print(s.MEDIA_ROOT)")
    env = {**os.environ, **env_extra}
    env.pop('DJANGO_MEDIA_ROOT', None)
    return subprocess.run([sys.executable, '-c', code], cwd=ROOT, env=env, capture_output=True, text=True)


class DataDirTest(SimpleTestCase):
    def test_uses_data_dir(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, '.itam-data').write_text('')
            r = run_settings({'ITAM_DATA_DIR': d})
            self.assertEqual(r.returncode, 0, r.stderr)
            db, media = r.stdout.split()
            self.assertEqual(db, str(Path(d, 'db.sqlite3')))
            self.assertEqual(media, str(Path(d, 'media')))

    def test_refuses_unmounted_volume(self):
        with tempfile.TemporaryDirectory() as d:  # 표시 파일 없음 = 마운트 안 된 빈 폴더
            r = run_settings({'ITAM_DATA_DIR': d})
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('.itam-data', r.stderr)
