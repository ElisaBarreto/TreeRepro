#!/bin/sh
# Latency report from the production access log (docs/gotchas/infra.md
# "Is the server keeping up?"). Run on the server as root:
#   sh scripts/latency-report.sh [days]   (default 1)
# Prints request count, 5xx count and p50/p95/p99 overall, then the 15 routes
# with the worst p95 (ids collapsed to :id). Reads no IPs; prints none.
set -eu
DAYS="${1:-1}"
LOGS=/var/lib/docker/volumes/treerepro_caddy-logs/_data
SINCE=$(( $(date +%s) - DAYS * 86400 ))

zcat -f "$LOGS"/access*.log* | jq -c --argjson since "$SINCE" '
  select(.ts >= $since and .request.uri != null) | {
    route: (.request.method + " " + (.request.uri
      | sub("\\?.*"; "")
      | gsub("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"; ":id")
      | gsub("/[0-9]+(?=/|$)"; "/:id"))),
    d: .duration, s: .status }' | jq -rs --arg days "$DAYS" '
  def pct(p): sort | .[((length * p) | ceil) - 1] * 1000 | round;
  def ms(xs): "p50 \(xs | pct(0.5)) ms  p95 \(xs | pct(0.95)) ms  p99 \(xs | pct(0.99)) ms";
  . as $all
  | if ($all | length) == 0 then "no requests in the last \($days) day(s)" else
    "last \($days) day(s): \($all | length) requests, \([$all[] | select(.s >= 500)] | length) with 5xx",
    "overall: " + ms([$all[].d]),
    "",
    "worst p95 by route (min 5 requests):",
    ( $all | group_by(.route) | map(select(length >= 5)
        | {route: .[0].route, n: length, p95: ([.[].d] | pct(0.95)), line: ms([.[].d])})
      | sort_by(-.p95) | .[:15][] | "  \(.line)  n=\(.n)  \(.route)" )
    end'
