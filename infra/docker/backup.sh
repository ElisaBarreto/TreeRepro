#!/bin/sh
# Daily encrypted logical backup (design spec section 7; RFC-10 R9).
# Runs as treerepro_backup, a read-only role (pg_read_all_data); the dump
# carries no owners or grants so it restores as whichever role runs psql
# (docs/gotchas/infra.md, "Restoring a backup").
set -eu
# A failing pg_dump must fail the pipeline, not leave an empty "successful" .age file.
set -o pipefail
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
PGPASSWORD="$(cat /run/secrets/db_backup_password)"
export PGPASSWORD
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
target="/backups/treerepro-${stamp}.sql.age"
pg_dump --host postgres --username treerepro_backup --dbname treerepro --no-owner --no-privileges --format=plain \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$target"
find /backups -name 'treerepro-*.sql.age' -mtime +30 -delete
echo "backup written: $target"
# Dead man's switch (optional): a monitor that expects this ping daily alerts
# when it stops arriving. A failed ping is logged but does not fail the backup.
if [ -n "${BACKUP_PING_URL:-}" ]; then
  wget -q -O /dev/null -T 10 "$BACKUP_PING_URL" || echo "backup ping failed: $BACKUP_PING_URL"
fi
