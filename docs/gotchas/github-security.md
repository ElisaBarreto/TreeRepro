# GitHub security automation

What runs, where it is configured, and what only a repository admin can change.

## Where each control lives

| Control | File / place | Trigger |
|---|---|---|
| Lint, typecheck, RFC links, build, tests, `pnpm audit` | `.github/workflows/ci.yml` (`Verify`) | PR, push main, weekly |
| Image build + Trivy vulnerability scan (api, web) | `.github/workflows/ci.yml` (`Images`) | PR, push main, weekly |
| CodeQL (`javascript-typescript`, `actions`) | `.github/workflows/codeql.yml` | PR, push main, weekly |
| Dependency review (new vulnerable deps in a PR) | `.github/workflows/security.yml` (`Dependency review`) | PR |
| Gitleaks (secrets in git history) | `.github/workflows/security.yml` (`Gitleaks`) | PR, push main, weekly |
| zizmor (workflow security lint) | `.github/workflows/security.yml` (`Zizmor`) | PR, push main, weekly |
| Trivy config (Dockerfile / Compose misconfiguration) | `.github/workflows/security.yml` (`Trivy config`) | PR, push main, weekly |
| OpenSSF Scorecard | `.github/workflows/scorecard.yml` | push main, weekly |
| Dependabot version updates (npm, actions, docker, compose) | `.github/dependabot.yml` | weekly, 7-day cooldown |
| pnpm release-age guard | `pnpm-workspace.yaml` (`minimumReleaseAge`) | every `pnpm install` |
| Vulnerability reporting policy | `SECURITY.md` | — |

All actions are pinned to a commit SHA with the version in a trailing comment. Dependabot updates the SHA and the comment together.

## Ruleset on `main` (admin only)

Source of truth: `infra/github/ruleset-main.json`, applied by `scripts/github-admin.sh` (creates or updates the ruleset named `main`); verify with `./scripts/github-admin.sh --check`. `integration_id` 15368 is the GitHub Actions app, so only Actions can satisfy a required check. Rules:

- Pull request required; no direct pushes, no force-push, no branch deletion.
- Required status checks (branch must be up to date with `main`): `Verify`, `Images`, `CodeQL (javascript-typescript)`, `CodeQL (actions)`, `Dependency review`, `Gitleaks`, `Zizmor`, `Trivy config`.
- Code scanning merge protection: CodeQL and zizmor alerts of severity high or higher (and any "error" level alert) block the merge. Trivy is not in this rule: its jobs already fail on HIGH/CRITICAL, and the `web` image carries unfixable-by-us findings inside the caddy binary.
- No review count required — CodeRabbit reviews every PR; a second human is not mandatory.

## Settings only an admin can change

The repository belongs to a personal account, so collaborators cannot be admins: only the owner can change these. `scripts/github-admin.sh`, run by the owner after `gh auth login`, applies everything below and the ruleset, idempotently; `--check` prints the live state without changing anything. Expected on:

- Dependency graph — without it `Dependency review` fails with "Dependency review is not supported on this repository".
- Dependabot alerts and Dependabot security updates (grouped).
- Secret scanning with push protection.
- Private vulnerability reporting.
- Automatically delete head branches after merge (Settings → General).

CodeQL uses the **advanced setup** (the workflow file). Do not turn on "default setup": GitHub refuses SARIF from the workflow while default setup is active.

## Required check never reports
**Symptom:** A PR stays blocked on a required check that shows as "Expected — waiting for status".
**Cause:** The check's job name changed, or the job has an `if:` that skipped it on this PR. Ruleset entries match check names literally.
**Fix:** Keep every required job unconditional on `pull_request` (except `Dependency review`, which only exists on PRs) and update the ruleset in the same PR whenever a job `name:` changes.

## Trivy fails on a base-image CVE
**Symptom:** `Images` fails on a HIGH/CRITICAL finding in an OS package of `treerepro-api` or `treerepro-web`.
**Cause:** Trivy runs with `ignore-unfixed: true`, so a fix exists in Alpine. Both runtime stages run `apk upgrade --no-cache` at build time, so this means the fix landed in an Alpine release the pinned base image does not track yet.
**Fix:** Merge the Dependabot docker PR that bumps the digest, or bump `FROM` in `infra/docker/*.Dockerfile` by hand. For a true false positive add a `vulnerabilities:` entry to `.trivyignore.yaml` with the CVE id, a statement and an expiry.

## CVEs inside the caddy binary are not gated
**Symptom:** `trivy image treerepro-web` locally lists HIGH findings in `usr/bin/caddy` (Go stdlib, x/net, grpc) but `Images` is green.
**Cause:** The `web` scan uses `vuln-type: os`. Go-binary findings need a new upstream caddy build; even the newest `caddy:alpine` tag carries several until its next release.
**Fix:** Nothing locally. Merge the Dependabot docker PR when a new caddy tag appears; check the binary's state with `trivy image --pkg-types library treerepro-web`.
