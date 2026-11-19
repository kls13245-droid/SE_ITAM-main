#!/bin/bash
# ITAM 데이터(DB·업로드 파일·백업)를 다른 디스크(볼륨)로 옮긴다.
#   사용: ./move-data.sh /data/itam
#   - ITAM을 잠깐 멈추고 → 복사 → 무결성 확인 → /etc/itam/data_dir 에 새 위치 기록 → 다시 시작
#   - 원래 파일은 지우지 않는다 (되돌리기: rm /etc/itam/data_dir && systemctl restart itam)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-}"
if [ -z "$DEST" ]; then
  echo "사용법: $0 <새 데이터 폴더>   예) $0 /data/itam" >&2
  exit 1
fi
DEST="$(realpath -m "$DEST")"

if [ -f /etc/itam/data_dir ]; then
  echo "이미 데이터 폴더가 설정돼 있습니다: $(head -n1 /etc/itam/data_dir)" >&2
  echo "다시 옮기려면 먼저 그 내용을 확인하세요." >&2
  exit 1
fi
SRC_DB="$ROOT/db.sqlite3"
[ -f "$SRC_DB" ] || { echo "원래 DB가 없습니다: $SRC_DB" >&2; exit 1; }

# 새 폴더가 정말 다른 디스크(볼륨)인지 확인
mkdir -p "$DEST"
MOUNT="$(df --output=target "$DEST" | tail -n1)"
if [ "$MOUNT" = "/" ] && [ "${ITAM_ALLOW_ROOT_DISK:-}" != "1" ]; then
  echo "경고: $DEST 는 OS 디스크(/)에 있습니다. 새 볼륨이 마운트됐는지 확인하세요 (df -h)." >&2
  exit 1
fi
if [ -e "$DEST/db.sqlite3" ]; then
  echo "$DEST 에 이미 db.sqlite3 가 있습니다. 덮어쓰지 않고 멈춥니다." >&2
  exit 1
fi
echo "새 위치: $DEST  (볼륨: $MOUNT, 여유 $(df -h --output=avail "$DEST" | tail -n1 | tr -d ' '))"

echo "1/5 ITAM 멈춤"
systemctl stop itam

restart_on_fail() { echo "실패 — 원래 위치 그대로 ITAM을 다시 시작합니다." >&2; systemctl start itam || true; }
trap restart_on_fail ERR

echo "2/5 DB 복사"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$SRC_DB" ".backup '$DEST/db.sqlite3'"
else
  cp -a "$SRC_DB" "$DEST/db.sqlite3"
fi

echo "3/5 업로드 파일·백업 복사"
[ -d "$ROOT/media" ] && cp -a "$ROOT/media" "$DEST/"
[ -d "$ROOT/backups" ] && cp -a "$ROOT/backups" "$DEST/"
mkdir -p "$DEST/media" "$DEST/backups"

echo "4/5 확인"
python3 - "$SRC_DB" "$DEST/db.sqlite3" <<'PY'
import sqlite3, sys
def info(p):
    c = sqlite3.connect(p)
    ok = c.execute('pragma integrity_check').fetchone()[0]
    tables = [r[0] for r in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
    rows = {t: c.execute(f'select count(*) from "{t}"').fetchone()[0] for t in tables}
    return ok, rows
ok1, a = info(sys.argv[1]); ok2, b = info(sys.argv[2])
if ok2 != 'ok' or a != b:
    print('복사본이 원본과 다릅니다', ok2, file=sys.stderr); sys.exit(1)
print(f'  무결성 ok, 표 {len(b)}개, 행 {sum(b.values())}개 원본과 같음')
PY
touch "$DEST/.itam-data"

echo "5/5 새 위치 기록하고 다시 시작"
mkdir -p /etc/itam
echo "$DEST" > /etc/itam/data_dir
trap - ERR
systemctl start itam
sleep 2
systemctl is-active itam >/dev/null && echo "완료: ITAM이 $DEST 의 DB로 동작합니다." \
  || { echo "ITAM이 시작되지 않았습니다: journalctl -u itam -n 50 확인. 되돌리기: rm /etc/itam/data_dir && systemctl restart itam" >&2; exit 1; }
echo "원래 파일($ROOT/db.sqlite3, media, backups)은 그대로 두었습니다. 며칠 써 보고 문제없으면 지워도 됩니다."
