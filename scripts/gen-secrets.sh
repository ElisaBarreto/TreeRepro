#!/bin/sh
# Generates development secrets in infra/secrets/ (RFC-02 R6). Never overwrites existing files.
# Values are hex only, so they are safe inside SQL and URLs.
#
# Permissions (infra/secrets/README.md): the directory is 0700 — the only host-side
# boundary — and every file is 0444, because Compose bind-mounts each file into the
# containers with its host owner and mode, and the services read it as uid 1000
# (node), 999 (redis) or 70 (postgres). Re-running the script repairs the modes.
set -eu
umask 077
dir="$(cd "$(dirname "$0")/.." && pwd)/infra/secrets"
mkdir -p "$dir"
chmod 700 "$dir"

gen() {
  name="$1"
  bytes="$2"
  if [ -f "$dir/$name" ]; then
    chmod 444 "$dir/$name"
    echo "keep   $name"
    return
  fi
  openssl rand -hex "$bytes" > "$dir/$name"
  chmod 444 "$dir/$name"
  echo "create $name"
}

gen db_superuser_password 24
gen db_app_password 24
gen db_migrator_password 24
gen db_backup_password 24
gen redis_password 24
gen pii_encryption_key_v1 32
gen pii_hmac_key 32
gen session_secret 32

if [ -f "$dir/smtp_password" ]; then
  chmod 444 "$dir/smtp_password"
  echo "keep   smtp_password"
else
  : > "$dir/smtp_password"
  chmod 444 "$dir/smtp_password"
  echo "create smtp_password (empty; fill in for authenticated SMTP)"
fi
