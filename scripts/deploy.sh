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
  exec 9>/tmp/treerepro-deploy.lock
  flock 9

  git fetch --quiet origin main
  # A leaked deploy key can only redeploy what is already on main.
  git merge-base --is-ancestor "$sha" origin/main || { echo "$sha is not on main" >&2; exit 3; }
  git checkout --quiet --detach "$sha"

  docker compose build --pull
  docker compose up -d --remove-orphans --wait
  docker image prune -f >/dev/null
  echo "deployed $sha"
}

main "$@"
