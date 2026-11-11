#!/usr/bin/env bash
# Rehearses a branch's migrations on a restored copy of production (plan 15a;
# procedure in docs/gotchas/import.md, "PlantRepro migrations: rehearsal and go").
#
#   scripts/rehearsal/run.sh <branch-sha>
#
# Downloads the newest daily dump from R2, restores it, streamed through
# `age -d | gunzip` so no decrypted dump touches the disk, into the postgres of
# a throwaway Compose project "treerepro-rehearsal" (never the dev stack's
# volume), runs checks.sql, applies the migrations of <branch-sha>, runs
# checks.sql again and prints the diff. The stack, its volume and the temp
# directory (encrypted dump, identity, generated secrets) are removed whatever
# the outcome. The two check outputs are kept in REHEARSAL_OUT (default: a new
# temp directory, printed at the end); they list user ids, so delete them once
# the diff is posted.
#
# Inputs: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, BACKUP_AGE_IDENTITY
# and optionally R2_BUCKET (default treereprobackups), read from REHEARSAL_ENV
# (default: the repository's .env) and never echoed. Needs Docker, age, git and
# this checkout's `pnpm install` (the migrator runs from it, on the branch's
# migration files).
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: $0 <branch-sha>" >&2; exit 2; }
root="$(cd "$(dirname "$0")/../.." && pwd)"
here="$root/scripts/rehearsal"
project=treerepro-rehearsal
env_file="${REHEARSAL_ENV:-$root/.env}"
sha="$(git -C "$root" rev-parse --verify "$1^{commit}")"

# One key from the env file, without sourcing it (it holds unrelated, unquoted values).
env_value() {
  grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2- || true
}
r2_endpoint="$(env_value R2_ENDPOINT)"
r2_key_id="$(env_value R2_ACCESS_KEY_ID)"
r2_secret="$(env_value R2_SECRET_ACCESS_KEY)"
age_identity="$(env_value BACKUP_AGE_IDENTITY)"
r2_bucket="$(env_value R2_BUCKET)"
r2_bucket="${r2_bucket:-treereprobackups}"
for v in r2_endpoint r2_key_id r2_secret age_identity; do
  [ -n "${!v}" ] || { echo "rehearsal: $v is missing from $env_file" >&2; exit 1; }
done
case "$r2_endpoint" in https://*) ;; *) echo "rehearsal: R2_ENDPOINT must be https://" >&2; exit 1 ;; esac

work="$(mktemp -d)"
chmod 700 "$work"
out="${REHEARSAL_OUT:-$(mktemp -d)}"
mkdir -p "$out"
export REHEARSAL_SECRETS_DIR="$work/secrets"

# Always this project name: a bare `docker compose down -v` would take the dev stack's.
compose() {
  docker compose -p "$project" -f "$root/compose.yml" -f "$here/compose.yml" "$@"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if ! compose down -v --remove-orphans >/dev/null 2>&1; then
    echo "rehearsal: teardown failed; run: REHEARSAL_SECRETS_DIR=x docker compose -p $project -f compose.yml -f scripts/rehearsal/compose.yml down -v" >&2
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT INT TERM

# R2 GET with SigV4; the credentials go to curl through a config on stdin, never argv.
r2_get() {
  printf 'user = "%s:%s"\n' "$r2_key_id" "$r2_secret" \
    | curl -fsS --proto =https -K - --retry 3 --connect-timeout 20 --aws-sigv4 "aws:amz:auto:s3" \
      -H 'x-amz-content-sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' "$@"
}

echo "rehearsal: branch $sha"
mkdir -p "$work/branch"
git -C "$root" archive "$sha" apps/api/drizzle | tar -x -C "$work/branch"

# Dump names carry a UTC timestamp, so the last key in order is the newest.
key="$(r2_get "$r2_endpoint/$r2_bucket?list-type=2&prefix=daily/" \
  | grep -o '<Key>daily/treerepro-[^<]*\.sql\.gz\.age</Key>' | sed 's/<[^>]*>//g' | sort | tail -n 1)"
[ -n "$key" ] || { echo "rehearsal: no daily dump found in R2" >&2; exit 1; }
echo "rehearsal: downloading $key"
r2_get -o "$work/dump.sql.gz.age" "$r2_endpoint/$r2_bucket/$key"
(umask 077; printf '%s\n' "$age_identity" > "$work/identity")

sh "$root/scripts/gen-secrets.sh" "$REHEARSAL_SECRETS_DIR" >/dev/null
echo "rehearsal: starting $project"
compose up -d --wait postgres >/dev/null 2>&1

# psql inside the container, as $1 with its password from its secret file.
psql_as() {
  local user="$1" secret="$2"
  shift 2
  compose exec -T postgres sh -c "PGPASSWORD=\"\$(cat /run/secrets/$secret)\" exec psql -X -v ON_ERROR_STOP=1 -U $user -d treerepro \"\$@\"" psql "$@"
}
checks() {
  # shellcheck disable=SC2016 # expanded by the container shell, not this one
  compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres \
    sh -c 'PGPASSWORD="$(cat /run/secrets/db_superuser_password)" exec psql -X -At -v ON_ERROR_STOP=1 -U postgres -d treerepro' \
    < "$here/checks.sql"
}

# As the migrator, so it owns every table (docs/gotchas/infra.md, "Restoring a backup").
echo "rehearsal: restoring"
age -d -i "$work/identity" "$work/dump.sql.gz.age" | gunzip \
  | psql_as treerepro_migrator db_migrator_password --single-transaction -q >/dev/null
rm -f "$work/dump.sql.gz.age" "$work/identity"

echo "rehearsal: before checks"
checks > "$out/before.txt"

echo "rehearsal: migrating to $sha"
port="$(compose port postgres 5432 | sed 's/.*://')"
(cd "$root/apps/api" && DB_HOST=127.0.0.1 DB_PORT="$port" DB_NAME=treerepro DB_MIGRATOR_USER=treerepro_migrator \
  SECRETS_DIR="$REHEARSAL_SECRETS_DIR" node --conditions=development --input-type=module -e '
    const { loadMigratorConfig } = await import("./src/config.ts");
    const { runMigrations } = await import("./src/db/migrator.ts");
    await runMigrations(loadMigratorConfig(process.env).db.url.expose(), process.argv[1]);
  ' "$work/branch/apps/api/drizzle")

echo "rehearsal: after checks"
checks > "$out/after.txt"

echo "rehearsal: diff (outputs in $out)"
if diff -u "$out/before.txt" "$out/after.txt"; then
  echo "rehearsal: no difference"
fi
