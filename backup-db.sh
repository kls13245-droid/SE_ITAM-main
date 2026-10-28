#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DB="$ROOT/db.sqlite3"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP="${KEEP:-14}"

if [ ! -f "$DB" ]; then
  echo "DB 파일이 없습니다: $DB" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/db-$STAMP.sqlite3"

# 사용 중에도 안전하게 복사
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$DEST'"
else
  cp -a "$DB" "$DEST"
fi

# 오래된 백업 삭제 (기본 14개 유지)
ls -1t "$BACKUP_DIR"/db-*.sqlite3 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

echo "백업 완료: $DEST"
ls -lh "$DEST"
