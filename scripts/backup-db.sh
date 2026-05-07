#!/usr/bin/env bash
# NexyFab SQLite Backup Script
# Usage: ./scripts/backup-db.sh
# Cron: 0 2 * * * /path/to/scripts/backup-db.sh >> /var/log/nexyfab-backup.log 2>&1

set -euo pipefail

DB_PATH="${NEXYFAB_DB_PATH:-./nexyfab.db}"
BACKUP_DIR="${BACKUP_DIR:-./data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/nexyfab_$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "[$(date)] ERROR: Database not found at $DB_PATH"
  exit 1
fi

# Use SQLite's online backup (safe while DB is in use)
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# Verify backup
ORIGINAL_SIZE=$(stat -f%z "$DB_PATH" 2>/dev/null || stat -c%s "$DB_PATH")
BACKUP_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE")

echo "[$(date)] Backup created: $BACKUP_FILE (${BACKUP_SIZE} bytes, original: ${ORIGINAL_SIZE} bytes)"

# Clean up old backups
find "$BACKUP_DIR" -name "nexyfab_*.db" -mtime "+$RETENTION_DAYS" -delete
echo "[$(date)] Cleaned up backups older than $RETENTION_DAYS days"

# Optional: Upload to S3/B2 if configured
if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  aws s3 cp "$BACKUP_FILE" "s3://$S3_BACKUP_BUCKET/nexyfab-backups/$(basename $BACKUP_FILE)" --storage-class STANDARD_IA
  echo "[$(date)] Uploaded to S3: s3://$S3_BACKUP_BUCKET/nexyfab-backups/"
fi
