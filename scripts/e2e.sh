#!/bin/sh
# Runs the end-to-end suite (plan 05c, RFC-01 R6): generates secrets into a
# temp directory, builds the production images and starts them as the Compose
# project "treerepro-e2e" on loopback ports (compose.e2e.yml), waits for the
# site to answer through Caddy, seeds the first administrator, runs Playwright
# with the invitation link in its environment, and tears everything down —
# volumes included — whatever the outcome. Extra arguments go to Playwright
# (`pnpm test:e2e -- --headed`, `pnpm test:e2e -- -g "CSP"`).
#
# E2E_KEEP=1 leaves the stack running after the tests (inspect at
# http://localhost:8080, Mailpit at http://localhost:8026); tear it down with
# `E2E_SECRETS_DIR=<dir> docker compose -p treerepro-e2e -f compose.yml -f compose.e2e.yml down -v --remove-orphans`
# (any existing directory satisfies the interpolation — compose.e2e.yml only
# needs the variable set, the secret files themselves are gone by then).
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
project=treerepro-e2e
base_url="${E2E_BASE_URL:-http://localhost:8080}"
mailpit_url="${E2E_MAILPIT_URL:-http://localhost:8026}"
admin_email="${E2E_ADMIN_EMAIL:-admin@e2e.test}"
results="$root/apps/e2e/test-results"

secrets_dir="$(mktemp -d)"
export E2E_SECRETS_DIR="$secrets_dir"

compose() {
  docker compose -p "$project" -f "$root/compose.yml" -f "$root/compose.e2e.yml" "$@"
}

cleanup() {
  status=$?
  # Disarm before doing anything else: EXIT, INT and TERM all point at this
  # function, and it ends in `exit "$status"`, which re-fires the EXIT trap.
  # Without disarming first, a SIGTERM runs this body twice — signal
  # invocation, then the EXIT trap re-fired by its own `exit` — and the
  # second pass re-captures `compose logs` against an already-torn-down
  # stack, overwriting stack.log with empty/error output. (`status=$?` must
  # come first: the `trap` builtin itself would otherwise overwrite `$?`
  # with its own success code before we read the real one.)
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    mkdir -p "$results"
    compose logs --no-color --timestamps > "$results/stack.log" 2>&1 || true
    echo "e2e: stack logs in apps/e2e/test-results/stack.log" >&2
  fi
  if [ "${E2E_KEEP:-}" = "" ]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$secrets_dir"
  else
    echo "e2e: E2E_KEEP set, stack left running as project $project" >&2
    echo "e2e: secrets kept at $secrets_dir; remove them after the teardown" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

sh "$root/scripts/gen-secrets.sh" "$secrets_dir" >/dev/null

echo "e2e: building and starting $project"
compose up -d --build

echo "e2e: waiting for $base_url"
i=0
until curl -fsS "$base_url/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 90 ]; then
    echo "e2e: $base_url/api/health did not answer within 180 s" >&2
    exit 1
  fi
  sleep 2
done

echo "e2e: seeding $admin_email"
seed="$(compose run --rm --no-deps -T api node dist/cli/seed-admin.js --email "$admin_email" --name "Ada Admin")"
link="$(printf '%s\n' "$seed" | sed -n 's/^Link (expires [^)]*): //p' | head -n 1)"
if [ -z "$link" ]; then
  echo "e2e: seed-admin printed no invitation link:" >&2
  printf '%s\n' "$seed" >&2
  exit 1
fi

echo "e2e: running Playwright"
cd "$root"
E2E_BASE_URL="$base_url" E2E_MAILPIT_URL="$mailpit_url" E2E_ADMIN_EMAIL="$admin_email" \
  E2E_ADMIN_INVITE_LINK="$link" \
  pnpm --filter @treerepro/e2e --fail-if-no-match exec playwright test "$@"
