# Platform 12b — Job Runs and the Daily Digest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** A `job_runs` table recorded by the audit purge and by a new hourly digest timer that, once a day and only when the window had activity, e-mails every active manager and admin a summary of records, contests, complements, validations, disputes, withdrawals, proposals and the queue sizes.

**Architecture:** `apps/api/src/jobs/runs.ts` (`startRun`, `finishRun`, `latestRun`); `apps/api/src/jobs/digest.ts` (`isDigestDue`, `computeDigest`, `renderDigest` via `mail/templates.ts`, `runDigest`, `startDigestTimer`); `server.ts` starts it beside the retention timer; `audit/retention.ts` records its runs. `job_runs_purge()` removes runs older than a year on the retention schedule.

**Spec:** `docs/specs/2026-09-17-platform-design.md` §4, §9. Depends on plan 09a (intent, `generated`), 11b (queue counts). Plan 12c later adds proposal counts (until then 0).

## Global Constraints

Same as plan 08a. Branch `feat/platform-12b` in worktree `../Elisa-12b`. New env `DIGEST_ENABLED` (default `true`); the E2E Compose sets `false`.

## File structure (end state)

```
docs/rfc/70-workspace/74-daily-digest.md                 # new
docs/rfc/40-data-protection/42-audit-retention.md        # R4, R6 amended
docs/rfc/40-data-protection/41-audit-log.md              # digest.sent
apps/api/drizzle/0028_job_runs.sql                       # generated + purge function + grants
apps/api/src/db/schema/job-runs.ts (+ test in a new job-runs.integration.test.ts)
apps/api/src/jobs/runs.ts (+ .integration.test.ts)
apps/api/src/jobs/digest.ts (+ .test.ts, .integration.test.ts)
apps/api/src/mail/templates.ts (+ test)                  # digestEmail
apps/api/src/audit/retention.ts (+ test)                 # records runs; job_runs_purge
apps/api/src/config.ts                                   # digestEnabled
apps/api/src/server.ts
apps/api/src/audit/actions.ts; packages/contracts/src/audit.ts
.env.example, compose.e2e.yml, README.md
```

---

### Task 1: RFC-74 and amendments

- [ ] RFC-74 `draft`, R1–R7 verbatim from the spec §4. RFC-42: R4 "`purgeAudit` records a `job_runs` row of kind `audit_purge` with `detail.purged`"; R6 "`job_runs_purge()` deletes runs older than one year, called by the retention timer after the audit purge, `SECURITY DEFINER` with pinned `search_path`". RFC-41 action `digest.sent`. README row. Commit.

---

### Task 2: `job_runs` schema, purge function, `runs.ts`

- [ ] **Step 1: Failing tests** — `startRun(db, 'digest')` inserts `running`; `finishRun(db, id, { status: 'completed', detail })` sets `finished_at` and `detail`; `latestRun(db, 'digest')` answers the newest by `started_at`; the app role cannot `DELETE`; `job_runs_purge()` deletes rows older than one year (insert one with `started_at = now() - interval '400 days'` as superuser) and not newer ones; kind and status checks (23514).
- [ ] **Step 2: Schema**

```ts
/** @rfc RFC-74 R1 */
export const JOB_KINDS = ['audit_purge', 'digest'] as const;
export const JOB_STATUSES = ['running', 'completed', 'failed', 'skipped'] as const;
export const jobRuns = pgTable('job_runs', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  kind: text('kind', { enum: JOB_KINDS }).notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  status: text('status', { enum: JOB_STATUSES }).notNull().default('running'),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
}, (t) => [index('job_runs_kind_idx').on(t.kind, t.startedAt.desc()), check('job_runs_kind_check', sql`${t.kind} in ('audit_purge', 'digest')`), check('job_runs_status_check', sql`${t.status} in ('running', 'completed', 'failed', 'skipped')`)]);
```

Migration `db:generate --name job_runs`, then append:

```sql
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON job_runs FROM treerepro_app;
--> statement-breakpoint
CREATE FUNCTION job_runs_purge() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM job_runs WHERE started_at < now() - interval '1 year';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION job_runs_purge() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION job_runs_purge() TO treerepro_app;
```

- [ ] **Step 3: `runs.ts`** and the retention change (`purgeAudit` wraps its call in `startRun`/`finishRun`; `startRetentionTimer` calls `job_runs_purge()` after the audit purge and logs both counts).
- [ ] **Step 4: Commit** — `feat(api): job_runs, recorded audit purge, job_runs_purge (RFC-74 R1, R7; RFC-42 R4, R6)`.

---

### Task 3: Digest computation and template

**Interfaces:**

```ts
export interface DigestWindow { start: Date; end: Date }
export interface DigestCounts { records: number; contests: number; complements: number; validations: number; disputes: number; withdrawals: number; proposals: number; pendingGroups: number; disputedNow: number }
export interface DigestItem { speciesName: string; traitKey: string; valueText: string; actorName: string; recordId: string; createdAt: Date }
export interface Digest { window: DigestWindow; counts: DigestCounts; contests: DigestItem[]; disputes: DigestItem[] }
export function isDigestDue(latest: { status: string; finishedAt: Date | null; detail: { windowEnd?: string } } | null, now: Date): { due: boolean; windowStart: Date }
export async function computeDigest(db, window: DigestWindow): Promise<Digest>
export function hasActivity(counts: DigestCounts): boolean      // records + contests + complements + validations + disputes + withdrawals + proposals > 0
export async function digestRecipients(db): Promise<{ id: string; email: string; name: string }[]>
export function digestEmail(input: { digest: Digest; appOrigin: string; date: string }): MailContent   // in mail/templates.ts
```

- [ ] **Step 1: Failing unit tests** — `isDigestDue(null, now)` → due, window start `now − 24 h`; latest `completed` finished 23 h ago → not due; 24 h ago → due with `windowStart = latest.detail.windowEnd`; latest `failed` 1 h ago → due (a failure does not postpone), window start from the last completed/skipped run (pass both through a `latestSuccessful` argument — adjust the signature: `isDigestDue(lastSuccess, now)`); `hasActivity` on zeros → false. `digestEmail` text contains the subject `TreeRepro digest — 2026-09-17`, each count line, the two lists with record links `${appOrigin}/app/species/<speciesId>?record=<id>` (the species page opens the drawer from `?record=` — add that search param to the species route in this plan, web side), and no e-mail addresses.
- [ ] **Step 2: Failing integration tests** — `computeDigest` over a window with 2 manual records (1 contest, 1 complement), 3 confirms, 1 human dispute, 1 generated dispute (not counted), 1 withdrawal; `pendingGroups` and `disputedNow` current; the items carry decrypted actor names; `digestRecipients` returns active users holding `records.review` through any role or `admin`, not a suspended manager, not a contributor.
- [ ] **Step 3: Implement; commit** — `feat(api): digest computation, recipients and template (RFC-74 R2-R5)`.

---

### Task 4: `runDigest`, the timer, config

- [ ] **Step 1: Failing integration test** — `runDigest({ db, mailer: fake, appOrigin, now })`: with activity and two recipients → two mails, a `completed` run with `detail: { windowStart, windowEnd, recipients: 2, failed: 0, counts }`, one audit entry `digest.sent`; with no activity → `skipped` run, no mail; a mailer that rejects for one recipient → `failed: 1`, still `completed`; `DIGEST_ENABLED=false` → `skipped` with `reason: 'disabled'`; a second `runDigest` right after → nothing (not due).
- [ ] **Step 2: Failing unit test** — `startDigestTimer({ run, logger, intervalMs: 10, initialDelayMs: 0 })` calls `run` on the first tick and again after the interval; errors are logged, never thrown; `stop()` clears it.
- [ ] **Step 3: Implement** — `config.ts`: `digestEnabled: boolean` from `DIGEST_ENABLED` (`'false'` → false); `server.ts` starts `startDigestTimer({ run: () => runDigest({ db, mailer, appOrigin, enabled }), logger })` (hourly, first tick after 60 s, `unref`).
- [ ] **Step 4: Commit** — `feat(api): daily digest timer (RFC-74 R2, R6)`.

---

### Task 5: Web `?record=` and close-out

- [ ] The species route accepts `?record=<uuid>` and opens the drawer on mount (test); `.env.example` `DIGEST_ENABLED=true`; `compose.e2e.yml` `DIGEST_ENABLED: 'false'`; README (Security automation / API paragraph: the daily digest and `job_runs`); RFC-74 → accepted; spec status; full checks; PR `feat: daily digest to managers and admins (plan 12b)`; one CodeRabbit run.

## Self-review

- Spec §4 R1 → Task 2; R2 → Tasks 3–4; R3–R5 → Task 3; R6 → Task 4; R7 → Task 2; §9 → each task.
