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

Configured in Settings → Rules → Rulesets, or via `gh api repos/ElisaBarreto/TreeRepro/rulesets`. Verify the live state with `gh api repos/ElisaBarreto/TreeRepro/rulesets`. Expected rules:

- Pull request required; no direct pushes, no force-push, no branch deletion.
- Required status checks (branch must be up to date with `main`): `Verify`, `Images`, `CodeQL (javascript-typescript)`, `CodeQL (actions)`, `Dependency review`, `Gitleaks`, `Zizmor`, `Trivy config`.
- Code scanning merge protection: CodeQL, zizmor and Trivy alerts of severity high or higher (and any "error" level alert) block the merge.
- No review count required — CodeRabbit reviews every PR; a second human is not mandatory.

## Settings only an admin can change

Settings → Code security. Verify with `gh api repos/ElisaBarreto/TreeRepro --jq .security_and_analysis`. Expected on:

- Dependabot alerts and Dependabot security updates (grouped).
- Secret scanning with push protection.
- Private vulnerability reporting.
- Automatically delete head branches after merge (Settings → General).

CodeQL uses the **advanced setup** (the workflow file). Do not turn on "default setup": GitHub refuses SARIF from the workflow while default setup is active.

## Required check never reports
**Symptom:** A PR stays blocked on a required check that shows as "Expected — waiting for status".
**Cause:** The check's job name changed, or the job has an `if:` that skipped it on this PR. Ruleset entries match check names literally.
**Fix:** Keep every required job unconditional on `pull_request` (except `Dependency review`, which only exists on PRs) and update the ruleset in the same PR whenever a job `name:` changes.

## Trivy fails on an unfixable CVE
**Symptom:** `Images` fails on a HIGH/CRITICAL finding in a base image with no upstream fix.
**Cause:** Trivy runs with `ignore-unfixed: true`, so this only happens when a fix exists and the base image digest is stale.
**Fix:** Merge the Dependabot docker PR that bumps the digest, or bump `FROM` in `infra/docker/*.Dockerfile` by hand. For a true false positive add a `.trivyignore` entry with the CVE id and an expiry comment.
