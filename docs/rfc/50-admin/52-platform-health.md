# RFC-52 — Platform health

| Field | Value |
|---|---|
| Status | accepted |
| Category | admin |
| Supersedes | — |

## Context

An administrator today reads the platform's condition off several separate screens — users, dataset totals, the curation queues, the two background jobs, imports. This RFC gives `health.read` holders one route that answers all of it in a single snapshot: counts, ids and timestamps only, cached briefly because it is read often and changes slowly.

## Rules

- **R1** `GET /api/admin/health` (`health.read`) answers `{ users: { active, invited, suspended, signedInLast7d, signedInLast30d }, dataset: { species, activeSpecies, traits, activeTraits, references, records, coverageCells, acceptedCells }, activity: { records7d, annotations7d, proposals7d, byDay: [{ day, records, annotations }] (14 days) }, queues: { pendingGroups, disputed, contested, proposals }, jobs: { auditPurge: <run>, digest: <run> } (the newest `job_runs` row per kind as `{ startedAt, finishedAt, status, detail, error } | null`), imports: [<RFC-64 R11 item> … 5 newest], computedAt }`. `imports` items are `healthImportSchema` — the RFC-64 R11 item without `runBy` (a name is PII, R2). `signedInLast7d` and `signedInLast30d` count distinct `actor_user_id` over the audit log's `auth.login.success` entries in the window; the query is bounded by the existing `audit_log_at_idx (at desc)`, which serves the `at >=` predicate before the `action` filter applies (one indexed query; no new index). `dataset.records` is `sum(species_trait_coverage.record_count)` and `dataset.references` is a flat `count(*)` over `bibliographic_references` (it has no `active` column) — the same definitions `computeDatasetStats` already gives these numbers; no number in this codebase carries a second definition. `dataset.coverageCells` is the count of species × trait cells that have at least one record and `dataset.acceptedCells` is the count that have an accepted value, so that `acceptedCells <= coverageCells <= activeSpecies * activeTraits` always holds. Both are measured over the **active** catalog — active species × active traits, the same grid for every caller — which is what makes that invariant hold and what the health page's completeness meter divides by; they therefore differ from the totals the coverage page shows an administrator, who holds `dataset.read_inactive` and so sees the full grid including deactivated species and traits. A documented difference between two pages, not a disagreement between two numbers. `activity.records7d` and `byDay.records` count records of **every origin**, not manual entry alone, matching `dataset.records`, which also counts every origin — two adjacent numbers counting different populations would read as a bug. `activity.proposals7d` counts proposals **created** in the 7-day window; `queues.proposals` counts **open** proposals — two different numbers from two different queries, never interchanged. The payload is global: computed once with no per-viewer visibility or permission gate applied to any number, which is also what makes one shared cache entry correct for every caller. Cached one minute in Redis under the key `health` (a fixed key, not per-viewer, per R above); a cache read that misses computes and stores a fresh value with a 60 second TTL.
- **R2** No PII: counts, ids and timestamps only; a test walks the schema's key paths and refuses `name`, `email`, `ip`, `userAgent`. The route emits no audit entry.
- **R3** Job badge (web): both `jobs.auditPurge` and `jobs.digest` use one rule, so the two rows never diverge in meaning, and the rule is total over every `JobStatus` (`running`, `completed`, `failed`, `skipped`) plus the no-run case. Given a job's newest run: `never ran` when the run is `null`; red `failed` when `status` is `failed`, whichever job it is and whatever the run's age; otherwise (`completed`, `skipped`, or `running`) green, labelled with the status, when `startedAt` is within the last 26 hours, else amber `stale`. Neither daily job is a long-running batch, so a `running` row two minutes old is healthy and one still `running` after 26 hours is stuck — the same 26-hour grace window that separates a fresh completed run from a stale one separates those two cases too, and "stale" is the right word for a job stuck running past its expected cadence as much as for one that quietly stopped reporting.

Web (plan 12d): route `/app/admin/health` (nav **Health**, section Admin, permission `health.read`, icon `pulse`): tiles per group, a 14-day activity table, the two job rows badged per R3, the imports table linking to `/app/imports/$id`. Breadcrumb `Admin › Health`.

## Open questions

- If the sign-in window ever gets slow, the follow-up is a dedicated `(action, at desc)` index on `audit_log` — not needed today: `audit_log_at_idx` already bounds the 7/30-day scan before the `action` filter applies.

## Changelog

- 2026-09-19 — created, `draft` (plan 12d).
- 2026-09-19 — R3 corrected to name `running` explicitly and make the badge rule total over every `JobStatus` (ruling R-M; the original wording named only `completed`, `skipped`, `failed` and null).
- 2026-09-19 — accepted.
