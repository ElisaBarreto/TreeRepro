# RFC-74 — Daily digest

| Field | Value |
|---|---|
| Status | accepted |
| Category | workspace |
| Supersedes | — |

## Context

A contributor or manager holding review authority currently learns about new contests, disputes and pending groups only by opening the workspace dashboard (RFC-72) or the curation queues (RFC-65) themselves. A daily e-mail digest gives every such user yesterday's activity and the current queue sizes without asking them to check in. `job_runs` gives every background job — the digest and the audit purge (RFC-42) — a durable record of when it ran, what it did, and whether it succeeded, so a failed job leaves a trace rather than only a log line, and the health page (RFC-52) has something concrete to read.

## Rules

- **R1** Table `job_runs(id uuid default uuidv7(), kind text not null check in ('audit_purge', 'digest'), started_at timestamptz not null default now(), finished_at timestamptz null, status text not null check in ('running', 'completed', 'failed', 'skipped'), detail jsonb not null default '{}', error text null; index (kind, started_at desc))`. `audit_purge` runs record `{ purged }` (RFC-42 R4 amended: `purgeAudit` writes its run). `skipped` means the job decided there was nothing to do.
- **R2** Schedule: `startDigestTimer` ticks every hour (first tick 60 s after start, `unref`); a tick runs the digest when no `digest` run with status `completed` or `skipped` finished in the last 23 h 30 min (so an hourly tick lands once a day and a restart never doubles it). The window is `(last completed-or-skipped run's window end, now]`, or the last 24 h for the first run.
- **R3** Content, over the window and RFC-33 unrestricted: `records` (manual records created), `contests`, `complements` (by intent), `validations` (`confirm` annotations), `disputes` (`dispute` annotations with `generated = false`), `withdrawals`, `proposals` (RFC-75, 0 until plan 12c), `pendingGroups` (current, RFC-65 R8), `disputedNow` (current, RFC-65 R10), plus the 10 newest contests and 10 newest disputes as `{ species canonical name, trait key, value, actor name }`.
- **R4** Recipients: `active` users holding `records.review` through any role or holding `admin`, resolved by one query over `user_roles` / `role_permissions`. When the window's `records + contests + complements + validations + disputes + withdrawals + proposals` is 0 the run is `skipped` and nothing is sent.
- **R5** One e-mail per recipient (`digestEmail` template: plain text (the mailer sends `{ subject, text }`), subject `TreeRepro digest — <date>`, the counts, the two lists with links to the record drawer URLs, the queue sizes) sent through the mailer of RFC-20 with the 5 s timeout; a failed send is logged and counted in `detail.failed`; the run completes when every send was attempted. Audit `digest.sent` with `metadata: { recipients, failed, windowStart, windowEnd }` (no addresses).
- **R6** Configuration: `DIGEST_ENABLED` (default `true`; `false` skips every tick with a `skipped` run and `detail.reason = 'disabled'`). The E2E stack sets it `false`.
- **R7** `job_runs` is append-only in practice (the runtime role holds `INSERT` and `UPDATE` of its own row by id, no `DELETE`); the health page (RFC-52) reads it; rows older than one year are removed by `audit_log_purge()`'s companion `job_runs_purge()` on the same schedule (RFC-42 R6 amended).

## Open questions

None.

## Changelog

- 2026-09-19 — created.
- 2026-09-19 — accepted.
