#!/bin/sh
# Production deploy, run on the server as `deploy`. The CI Deploy job reaches it through
# the forced command of the deploy key (docs/gotchas/infra.md), passing the commit SHA
# as the SSH command; by hand: `scripts/deploy.sh <sha>`.
# Everything sits in main() so sh parses the whole file before `git checkout` rewrites it.
set -eu

main() {
  sha="${SSH_ORIGINAL_COMMAND:-${1:-}}"
  case "$sha" in
    *[!0-9a-f]* | "") echo "expected a full commit SHA" >&2; exit 2 ;;
  esac
  [ "${#sha}" -eq 40 ] || { echo "expected a full commit SHA" >&2; exit 2; }

  cd "$(dirname "$0")/.."
  # Production overrides even if .env lost its COMPOSE_FILE line.
  export COMPOSE_FILE=compose.yml:compose.prod.yml
  exec 9>/tmp/treerepro-deploy.lock
  flock 9

  git fetch --quiet origin main
  # A leaked deploy key can only redeploy what is already on main.
  git merge-base --is-ancestor "$sha" origin/main || { echo "$sha is not on main" >&2; exit 3; }
  # CI runs on main are not cancelled, so an older run can finish last: never roll back.
  head="$(git rev-parse HEAD)"
  if [ "$sha" != "$head" ] && git merge-base --is-ancestor "$sha" "$head"; then
    echo "skip: $sha is older than the deployed $head"
    exit 0
  fi
  git checkout --quiet --detach "$sha"

  docker compose build --pull
  docker compose up -d --remove-orphans --wait
  # cachedJson entries outlive the API container and may hold the previous release's
  # shape (#163). Sessions, login/rate-limit counters, TOTP setup and perms are kept.
  docker compose exec -T redis sh -c '
    set -eu -o pipefail
    export REDISCLI_AUTH="$(cat /run/secrets/redis_password)"
    for p in "stats:*" "dashboard:*" "coverage:*" "dictionary:*" "trait:*" "health"; do
      redis-cli --no-auth-warning --scan --pattern "$p" | xargs -r redis-cli --no-auth-warning del >/dev/null
    done'
  docker image prune -f >/dev/null
  echo "deployed $sha"
}

main "$@"
