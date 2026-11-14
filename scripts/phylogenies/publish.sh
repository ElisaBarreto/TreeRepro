#!/bin/sh
# Publishes the owner's phylogeny figures for one platform (RFC-79 R8).
#
#   TREEREPRO_HOST=root@<server> scripts/phylogenies/publish.sh <source dir> <treerepro|plantrepro>
#
# Runs on macOS (display copies are made with `sips`). Copies the figures to
# /srv/phylogenies-staging/<platform>/ on the server, checks them there against
# the production trait dictionary (check:phylogenies), and only if the check
# passes replaces /srv/phylogenies/<platform>/ with them. Uses the caller's SSH
# agent. Procedure: docs/gotchas/infra.md "Phylogeny figures (private)".
set -eu

usage() {
  echo "usage: TREEREPRO_HOST=root@<server> $0 <source dir> <treerepro|plantrepro>" >&2
  exit 2
}
[ $# -eq 2 ] || usage
SRC=$1
PLATFORM=$2
case $PLATFORM in treerepro | plantrepro) ;; *) usage ;; esac
HOST=${TREEREPRO_HOST:?set TREEREPRO_HOST, e.g. root@<server>}
REMOTE_DIR=${TREEREPRO_DIR:-/srv/treerepro}
command -v sips >/dev/null || { echo "sips not found: run this on macOS" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/display"
count=0
for f in "$SRC"/trait_*.png; do
  [ -e "$f" ] || { echo "no trait_*.png in $SRC" >&2; exit 1; }
  name=$(basename "$f" .png)
  cp "$f" "$WORK/$name.png"
  sips -s format jpeg -s formatOptions 80 -Z 1600 "$f" --out "$WORK/display/$name.jpg" >/dev/null
  count=$((count + 1))
done
# Files from a OneDrive folder arrive as 700; the API container must read them.
chmod -R u=rwX,go=rX "$WORK"
echo "== $count figures prepared"

echo "== staging on $HOST"
ssh "$HOST" "mkdir -p /srv/phylogenies-staging/$PLATFORM /srv/phylogenies/$PLATFORM"
rsync -a --delete "$WORK/" "$HOST:/srv/phylogenies-staging/$PLATFORM/"

echo "== checking against the production trait dictionary"
ssh "$HOST" "cd $REMOTE_DIR && docker compose run --rm --no-deps -T \
  -v /srv/phylogenies-staging:/staging:ro api node dist/cli/check-phylogenies.js \
  --dir /staging/$PLATFORM"

echo "== publishing"
ssh "$HOST" "rsync -a --delete /srv/phylogenies-staging/$PLATFORM/ /srv/phylogenies/$PLATFORM/"
echo "== done: $count figures live on $PLATFORM"
