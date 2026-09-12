#!/bin/sh
# Daily encrypted logical backup (design spec section 7; RFC-10 R9).
set -eu
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
PGPASSWORD="$(cat /run/secrets/db_migrator_password)"
export PGPASSWORD
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
target="/backups/treerepro-${stamp}.sql.age"
pg_dump --host postgres --username treerepro_migrator --dbname treerepro --no-owner --format=plain \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$target"
find /backups -name 'treerepro-*.sql.age' -mtime +30 -delete
echo "backup written: $target"
