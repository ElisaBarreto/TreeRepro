# Platform 12d — Platform Health Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** `GET /api/admin/health` (`health.read`) composing user, dataset, activity, queue, job and import numbers, cached one minute; the page `/app/admin/health`.

**Architecture:** `apps/api/src/admin/health.ts` runs ~12 small queries in parallel under `cachedJson`; nothing here writes. The page is tiles and two tables over one query, with amber/red badges for stale or failed jobs.

**Spec:** `docs/specs/2026-09-17-platform-design.md` §7, §8, §9. Depends on plans 12b (`job_runs`), 12c (proposal counts), 11b (queue counts, `Meter`), 10a (coverage).

## Global Constraints

Same as plan 08a. Branch `feat/platform-12d` in worktree `../Elisa-12d`.

## File structure (end state)

```
docs/rfc/50-admin/52-platform-health.md                  # new
docs/rfc/30-access/30-permission-catalog.md              # health.read
docs/rfc/10-platform/13-presentation-layer.md            # route
apps/api/drizzle/0030_permissions_health.sql             # custom (no role row)
apps/api/src/admin/health.ts (+ .integration.test.ts)
apps/api/src/http/routes/admin/health.ts (+ test), admin/index.ts
packages/contracts/src/health.ts (extend the existing file: platformHealthSchema) (+ test), permissions.ts
apps/web/src/api/admin.ts                                # fetchPlatformHealth
apps/web/src/pages/admin/HealthPage.tsx (+ test)
apps/web/src/components/admin/JobRow.tsx, ActivityTable.tsx (+ tests)
apps/web/src/routes/app/admin/health.tsx, components/shell/nav.ts, Icon.tsx (pulse)
```

---

### Task 1: RFC-52, permission, contracts

- [ ] RFC-52 `draft`, R1–R2 verbatim from the spec §7; RFC-30 `health.read` "View platform health" (admin only; no role row); RFC-13 route. Migration `0030_permissions_health.sql`. Contracts:

```ts
const n = z.number().int().nonnegative();
export const jobRunSummarySchema = z.strictObject({ startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(), status: z.enum(JOB_STATUSES), detail: z.record(z.string(), z.unknown()), error: z.string().nullable() });
export const platformHealthSchema = z.strictObject({
  users: z.strictObject({ active: n, invited: n, suspended: n, signedInLast7d: n, signedInLast30d: n }),
  dataset: z.strictObject({ species: n, activeSpecies: n, traits: n, activeTraits: n, references: n, records: n, coverageCells: n, acceptedCells: n }),
  activity: z.strictObject({ records7d: n, annotations7d: n, proposals7d: n, byDay: z.array(z.strictObject({ day: z.iso.date(), records: n, annotations: n })).length(14) }),
  queues: z.strictObject({ pendingGroups: n, disputed: n, contested: n, proposals: n }),
  jobs: z.strictObject({ auditPurge: jobRunSummarySchema.nullable(), digest: jobRunSummarySchema.nullable() }),
  imports: z.array(importBatchSchema).max(5),
  computedAt: z.iso.datetime(),
});
```

(`JOB_STATUSES` moves to contracts in this task; `apps/api/src/db/schema/job-runs.ts` imports it.) A test asserts the schema's key paths contain none of `email`, `name`, `ip`, `userAgent` (walk `platformHealthSchema.shape` recursively). Commit — `docs+feat(contracts): platform health (RFC-52)`.

---

### Task 2: Service and route

**Interfaces:** `platformHealth(ctx: { db; redis }): Promise<PlatformHealth>`; route `GET /api/admin/health` (`health.read`); meta-test list.

- [ ] **Step 1: Failing test** — synthetic data: users in three statuses; two `auth.login.success` audit entries for one user in the last 7 days and one for another user 20 days ago → `signedInLast7d 1`, `signedInLast30d 2`; dataset counts consistent with `species` (`activeSpecies` ≤ `species`), `records` = `sum(record_count)` over coverage, `coverageCells`, `acceptedCells`; `activity.byDay` has 14 entries ending today with today's inserted record counted; queues equal the plan 11b counters; `jobs.digest` is the newest `job_runs` row of that kind (insert two, assert the newer); `imports` are the 5 newest batches; the second call within a minute returns the same `computedAt`; a manager gets 403.
- [ ] **Step 2: Implement** (`cachedJson(redis, 'admin:health', 60, …)`; `byDay` from `generate_series(current_date - 13, current_date)` left-joined to counts grouped by `created_at::date`).
- [ ] **Step 3: Commit** — `feat(api): GET /api/admin/health (RFC-52 R1, R2)`.

---

### Task 3: Web

- [ ] **Step 1: Failing tests** — nav "Health" under Admin with `health.read`; tiles per group; `ActivityTable` 14 rows; `JobRow`: green when the newest run is `completed`/`skipped` within 26 h, amber "stale" when older, red "failed" on `failed`, "never ran" on null; the imports table links to `/app/imports/$id`; `Meter`s for `acceptedCells / coverageCells` and `coverageCells / (activeSpecies × activeTraits)`; breadcrumb `Admin › Health`; `NoPermission` otherwise.
- [ ] **Step 2: Implement; commit** — `feat(web): platform health page (RFC-52)`.

---

### Task 4: Close-out

- [ ] RFC-52 → accepted; spec status; README (admin API paragraph); full checks; E2E: the admin opens Health and sees the digest row "never ran" (E2E sets `DIGEST_ENABLED=false` — after the first hourly tick it would read `skipped`; assert either). PR `feat: platform health page (plan 12d)`; one CodeRabbit run.

## Self-review

- Spec §7 R1 → Task 2; R2 → Tasks 1–2 (no-PII test, cache); web → Task 3; permission → Task 1.
