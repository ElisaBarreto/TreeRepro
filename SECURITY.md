# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting instead:

https://github.com/ElisaBarreto/TreeRepro/security/advisories/new

You will get an acknowledgement within 7 days. Please include the affected
area (API, web, infrastructure), steps to reproduce, and the impact you see.

## Supported versions

Only the `main` branch is supported. There are no maintained release lines.

## What runs automatically

Every pull request runs CodeQL, Trivy (images and IaC), Gitleaks, zizmor,
`pnpm audit` and GitHub's dependency review; all but dependency review also
run weekly against `main`.
Dependabot proposes updates weekly with a 7-day release cooldown. Details in
`README.md` ("Security automation") and `docs/gotchas/github-security.md`.
