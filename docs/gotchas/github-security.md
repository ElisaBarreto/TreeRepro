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

Source of truth: `infra/github/ruleset-main.json`. Apply with `gh api -X POST repos/ElisaBarreto/TreeRepro/rulesets --input infra/github/ruleset-main.json` (or `-X PUT .../rulesets/<id>` to update); verify with `gh api repos/ElisaBarreto/TreeRepro/rulesets`. `integration_id` 15368 is the GitHub Actions app, so only Actions can satisfy a required check. Rules:

- Pull request required; no direct pushes, no force-push, no branch deletion.
- Required status checks (branch must be up to date with `main`): `Verify`, `Images`, `CodeQL (javascript-typescript)`, `CodeQL (actions)`, `Dependency review`, `Gitleaks`, `Zizmor`, `Trivy config`.
- Code scanning merge protection: CodeQL and zizmor alerts of severity high or higher (and any "error" level alert) block the merge. Trivy is not in this rule: its jobs already fail on HIGH/CRITICAL, and the `web` image carries unfixable-by-us findings inside the caddy binary.
- No review count required — CodeRabbit reviews every PR; a second human is not mandatory.

## Settings only an admin can change

Settings → Code security. Verify with `gh api repos/ElisaBarreto/TreeRepro --jq .security_and_analysis`. Expected on:

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

## Dependabot npm updates fail on every run
**Symptom:** The `Dependabot Updates` run for `npm_and_yarn` ends with `Could not download the pnpm 12.4.1 binary: Could not reach https://registry.npmjs.org/@pnpm/exe.linux-x64/12.4.1: fetch failed`; no npm PRs appear. Docker and GitHub Actions updates work.
**Cause:** pnpm 12's npm package is a launcher that downloads the native `@pnpm/exe` binary with a plain `fetch()`, ignoring Dependabot's proxy. Upstream bug: https://github.com/dependabot/dependabot-core/issues/16170 (open since 2026-09-03). Dependabot security updates for npm hit the same path.
**Fix:** Nothing on our side. Until upstream ships the fix, `pnpm audit` in `Verify`, `Dependency review` and CodeQL still cover npm; run `pnpm outdated` by hand for version bumps. Re-check the issue when the weekly run keeps failing.

## Dependabot proposes a major base-image bump
**Symptom:** A PR like "bump node from 24.21.0-alpine to 26.8-alpine" shows up and its checks are green.
**Cause:** Docker tags have no "engines" field; Dependabot cannot know Node 24 is the pinned runtime.
**Fix:** `.github/dependabot.yml` ignores `version-update:semver-major` for the `docker` and `docker-compose` ecosystems. A major runtime bump is a deliberate PR that also updates README "Stack", `package.json` engines and `.node-version`. Close the Dependabot PR with `@dependabot ignore this major version` so it is not reopened.
