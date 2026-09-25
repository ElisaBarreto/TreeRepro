#!/bin/sh
# Daily encrypted logical backup (design spec section 7; RFC-10 R9).
# Runs as treerepro_backup, a read-only role (pg_read_all_data); the dump
# carries no owners or grants so it restores as whichever role runs psql
# (docs/gotchas/infra.md, "Restoring a backup").
set -eu
# A failing pg_dump must fail the pipeline, not leave an empty "successful" .age file.
set -o pipefail
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
PGPASSWORD="$(cat /run/secrets/db_backup_password)"
export PGPASSWORD
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
target="/backups/treerepro-${stamp}.sql.age"
pg_dump --host postgres --username treerepro_backup --dbname treerepro --no-owner --no-privileges --format=plain \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$target"
find /backups -name 'treerepro-*.sql.age' -mtime +30 -delete
echo "backup written: $target"
# Off-site copy (RFC-10 R9): Cloudflare R2, whose lifecycle rules expire each
# prefix and whose bucket lock keeps every object undeletable for 30 days, so
# this host cannot wipe the copies. A failed upload fails the backup (no ping).
name="$(basename "$target")"
prefixes="daily"
[ "$(date -u +%u)" = 7 ] && prefixes="$prefixes weekly"
[ "$(date -u +%d)" = 01 ] && prefixes="$prefixes monthly"
sha="$(sha256sum "$target" | cut -d' ' -f1)"
for prefix in $prefixes; do
  # Credentials through a config on stdin, never on the command line.
  printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$(cat /run/secrets/r2_secret_access_key)" \
    | curl -fsS -K - --retry 3 --aws-sigv4 "aws:amz:auto:s3" \
      -H "x-amz-content-sha256: $sha" -T "$target" \
      "$R2_ENDPOINT/$R2_BUCKET/$prefix/$name"
  echo "backup uploaded: $prefix/$name"
done
# Dead man's switch (optional): a monitor that expects this ping daily alerts
# when it stops arriving. A failed ping is logged but does not fail the backup.
if [ -n "${BACKUP_PING_URL:-}" ]; then
  wget -q -O /dev/null -T 10 "$BACKUP_PING_URL" || echo "backup ping failed"
fi
