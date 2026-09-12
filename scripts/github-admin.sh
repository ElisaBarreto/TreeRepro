#!/bin/sh
# Applies the repository settings that only an admin can change (see
# docs/gotchas/github-security.md). Idempotent: safe to re-run at any time.
#
# Run as the repository owner (a personal repository has no admin role for
# collaborators):
#   gh auth login          # once, on the owner's machine
#   ./scripts/github-admin.sh
#
# Usage: ./scripts/github-admin.sh [--check]   (--check only prints the state)
set -eu

repo="ElisaBarreto/TreeRepro"
ruleset_file="$(cd "$(dirname "$0")/.." && pwd)/infra/github/ruleset-main.json"

command -v gh >/dev/null || { echo "gh (GitHub CLI) is required: https://cli.github.com" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "not logged in: run 'gh auth login' first" >&2; exit 1; }

check_only=false
[ "${1:-}" = "--check" ] && check_only=true

# ---------------------------------------------------------------------------
# Verification. Prints the live state; used at the end and by --check.
# ---------------------------------------------------------------------------
report() {
  echo
  echo "== $repo =="
  echo "logged in as:                   $(gh api user --jq .login)"
  echo "admin:                          $(gh api "repos/$repo" --jq .permissions.admin)"
  echo "delete branch on merge:         $(gh api "repos/$repo" --jq .delete_branch_on_merge)"
  echo "allow auto-merge:               $(gh api "repos/$repo" --jq .allow_auto_merge)"
  echo "secret scanning:                $(gh api "repos/$repo" --jq '.security_and_analysis.secret_scanning.status // "unknown"')"
  echo "push protection:                $(gh api "repos/$repo" --jq '.security_and_analysis.secret_scanning_push_protection.status // "unknown"')"
  echo "dependabot alerts (+ graph):    $(status_of "repos/$repo/vulnerability-alerts")"
  echo "dependabot security updates:    $(field_of "repos/$repo/automated-security-fixes" .enabled)"
  echo "private vulnerability report:   $(field_of "repos/$repo/private-vulnerability-reporting" .enabled)"
  echo "rulesets:                       $(gh api "repos/$repo/rulesets" --jq '[.[] | "\(.name) (\(.enforcement))"] | join(", ") | if . == "" then "none" else . end')"
  echo "ruleset 'main' vs file:         $(ruleset_drift)"
}

# Compares the live ruleset named "main" with infra/github/ruleset-main.json:
# target, enforcement, bypass actors, conditions, and every rule the file
# declares (each parameter the file sets must match; GitHub may add defaults).
ruleset_drift() {
  id="$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id' 2>/dev/null)"
  [ -n "$id" ] || { echo "missing"; return; }
  command -v python3 >/dev/null || { echo "unknown (python3 needed to compare)"; return; }
  live="$(mktemp)"
  gh api "repos/$repo/rulesets/$id" > "$live"
  python3 - "$ruleset_file" "$live" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    want = json.load(f)
with open(sys.argv[2]) as f:
    live = json.load(f)
drift = []
for key in ("target", "enforcement", "bypass_actors", "conditions"):
    # GitHub returns null for an empty bypass list.
    if (live.get(key) or []) != (want.get(key) or []):
        drift.append(key)
live_rules = {r["type"]: r.get("parameters", {}) for r in live.get("rules", [])}
want_rules = {r["type"]: r.get("parameters", {}) for r in want.get("rules", [])}
for rule_type, params in want_rules.items():
    if rule_type not in live_rules:
        drift.append(f"rule {rule_type} missing")
        continue
    for name, value in params.items():
        if live_rules[rule_type].get(name) != value:
            drift.append(f"rule {rule_type}.{name}")
for rule_type in live_rules.keys() - want_rules.keys():
    drift.append(f"extra rule {rule_type}")
print("matches" if not drift else "DRIFT: " + ", ".join(drift))
PY
  rm -f "$live"
}

# A JSON field, or "unknown" when the endpoint answers with an error.
field_of() {
  if value="$(gh api "$1" --jq "$2" 2>/dev/null)"; then echo "$value"; else echo unknown; fi
}

# 204 means enabled, 404 means disabled for the boolean GET endpoints.
status_of() {
  code="$(gh api "$1" -i 2>/dev/null | head -n 1 | cut -d' ' -f2 || true)"
  case "$code" in
    204) echo enabled ;;
    404) echo disabled ;;
    *) echo "unknown ($code)" ;;
  esac
}

if $check_only; then
  report
  exit 0
fi

# ---------------------------------------------------------------------------
# Apply. Order matters: Dependabot alerts turn on the dependency graph that
# the "Dependency review" check needs, and the ruleset requires that check.
# ---------------------------------------------------------------------------
if [ "$(gh api "repos/$repo" --jq .permissions.admin)" != "true" ]; then
  echo "the logged-in account is not an admin of $repo; run this as the owner" >&2
  exit 1
fi

step() { printf '%-52s' "$1"; }

step "dependabot alerts + dependency graph"
gh api -X PUT "repos/$repo/vulnerability-alerts" >/dev/null && echo ok

step "dependabot security updates"
gh api -X PUT "repos/$repo/automated-security-fixes" >/dev/null && echo ok

step "secret scanning + push protection"
gh api -X PATCH "repos/$repo" \
  --input - >/dev/null <<'EOF' && echo ok
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
EOF

step "private vulnerability reporting"
gh api -X PUT "repos/$repo/private-vulnerability-reporting" >/dev/null && echo ok

step "delete head branches after merge"
gh api -X PATCH "repos/$repo" -F delete_branch_on_merge=true >/dev/null && echo ok

# Lets .github/workflows/dependabot-auto-merge.yml queue minor/patch Dependabot
# PRs; the ruleset's required checks still gate the merge.
step "allow auto-merge"
gh api -X PATCH "repos/$repo" -F allow_auto_merge=true >/dev/null && echo ok

step "ruleset 'main' from infra/github/ruleset-main.json"
existing="$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id')"
if [ -n "$existing" ]; then
  gh api -X PUT "repos/$repo/rulesets/$existing" --input "$ruleset_file" >/dev/null && echo "updated (id $existing)"
else
  gh api -X POST "repos/$repo/rulesets" --input "$ruleset_file" >/dev/null && echo created
fi

report
