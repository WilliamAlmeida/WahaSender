#!/usr/bin/env bash
# WahaSender backup helper.
# Usage:
#   ./scripts/backup.sh           # sqlite mode (default)
#   DB_CLIENT=pg ./scripts/backup.sh
set -euo pipefail

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"

DB_CLIENT="${DB_CLIENT:-sqlite3}"

if [ "$DB_CLIENT" = "pg" ]; then
  : "${DB_HOST:=localhost}"
  : "${DB_PORT:=5432}"
  : "${DB_USER:=postgres}"
  : "${DB_DATABASE:=waha_sender}"
  OUT="$OUT_DIR/wahasender_${STAMP}.sql.gz"
  echo "[backup] postgres → $OUT"
  PGPASSWORD="${DB_PASSWORD:-}" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_DATABASE" | gzip > "$OUT"
else
  SQLITE_FILE="${SQLITE_FILE:-./storage/database.sqlite}"
  if [ ! -f "$SQLITE_FILE" ]; then
    echo "[backup] sqlite file not found at $SQLITE_FILE" >&2
    exit 1
  fi
  OUT="$OUT_DIR/wahasender_${STAMP}.sqlite"
  echo "[backup] sqlite → $OUT"
  sqlite3 "$SQLITE_FILE" ".backup '$OUT'"
  gzip -f "$OUT"
fi

# Uploads
if [ -d "./storage/uploads" ]; then
  UPLOADS_OUT="$OUT_DIR/uploads_${STAMP}.tar.gz"
  echo "[backup] uploads → $UPLOADS_OUT"
  tar -czf "$UPLOADS_OUT" -C ./storage uploads
fi

echo "[backup] done"
