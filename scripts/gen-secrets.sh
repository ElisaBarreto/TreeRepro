#!/bin/sh
# Generates development secrets in infra/secrets/ (RFC-02 R6). Never overwrites existing files.
# Values are hex only, so they are safe inside SQL and URLs.
set -eu
dir="$(cd "$(dirname "$0")/.." && pwd)/infra/secrets"
mkdir -p "$dir"

gen() {
  name="$1"
  bytes="$2"
  if [ -f "$dir/$name" ]; then
    echo "keep   $name"
    return
  fi
  openssl rand -hex "$bytes" > "$dir/$name"
  chmod 600 "$dir/$name"
  echo "create $name"
}

gen db_superuser_password 24
gen db_app_password 24
gen db_migrator_password 24
gen redis_password 24
gen pii_encryption_key_v1 32
gen pii_hmac_key 32
gen session_secret 32
