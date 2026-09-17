# Workspace 11a — My Contributions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** `GET /api/me/contributions` (the viewer's manual records or annotations, filterable), `GET /api/me/contributions/summary`, the same two routes for another user under `contributions.read`, and the page `/app/contributions` with tabs, filters, status badges and the record drawer.

**Architecture:** `apps/api/src/dataset/contributions.ts` builds on `itemQuery` (records) and a new annotation query; two indexes make the per-user reads cheap. The page is `ContributionsPage` reused for `?userId=`.

**Spec:** `docs/specs/2026-09-17-workspace-design.md` §3, §6, §7. Depends on plans 09a (intent, annotation reference), 08b (visibility) and 10a (`ctx.redis` is not needed here, but the coverage table's indexes are).

## Global Constraints

Same as plan 08a. Branch `feat/workspace-11a` in worktree `../Elisa-11a`.

## File structure (end state)

```
docs/rfc/70-workspace/71-my-contributions.md             # new
docs/rfc/30-access/30-permission-catalog.md, 31-roles.md # contributions.read
docs/rfc/10-platform/13-presentation-layer.md            # route
apps/api/drizzle/0026_contributions.sql                  # custom: permission + manager row + two indexes
apps/api/src/db/schema/curation.ts, records.ts           # indexes
apps/api/src/dataset/contributions.ts (+ test)
apps/api/src/http/routes/contributions.ts (+ test), app.ts   # /api/me/contributions*; /api/admin/users/:id/contributions* is added to routes/admin/users.ts
packages/contracts/src/contributions.ts (+ test), index.ts, permissions.ts
apps/web/src/api/contributions.ts
apps/web/src/pages/workspace/ContributionsPage.tsx (+ test)
apps/web/src/components/workspace/ContributionFilters.tsx, AnnotationTable.tsx, StatTiles.tsx (+ tests)
apps/web/src/routes/app/contributions.tsx
apps/web/src/components/shell/nav.ts, Icon.tsx (user)
apps/web/src/pages/admin/UserPage.tsx                    # "View contributions" link
```

---

### Task 1: RFC-71 and amendments

- [ ] RFC-71 `draft`, category workspace, R1–R6 verbatim from the spec §3, plus the visibility note the spec's §7 asks for: "R2/R3 apply RFC-33: a viewer's own record on a species they may no longer see is omitted from the lists; the summary (R4) counts every row regardless, so the numbers stay true." RFC-30 `contributions.read` "View any user's contributions"; RFC-31 R10 manager += `contributions.read`; RFC-13 R2 route `/app/contributions`. README row. Commit.

---

### Task 2: Contracts

**Interfaces (produces):**

```ts
export const CONTRIBUTION_KINDS = ['records', 'annotations'] as const;
export const listContributionsQuerySchema = cursorQuerySchema.extend({
  kind: z.enum(CONTRIBUTION_KINDS), traitId: z.uuid().optional(), speciesId: z.uuid().optional(),
  review: z.enum(REVIEW_STATUSES).optional(), intent: z.enum([...RECORD_INTENTS, 'none']).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
});
export const contributionRecordSchema = recordSchema.extend({ isAccepted: z.boolean(), responseCount: z.number().int().nonnegative() });
export const contributionAnnotationSchema = z.strictObject({ id: z.uuid(), kind: z.enum(ANNOTATION_KINDS), note: z.string().nullable(), reference: referenceRefSchema.nullable(), generated: z.boolean(), createdAt: z.iso.datetime(), record: recordSchema });
export const contributionSummarySchema = z.strictObject({ records: n, contests: n, complements: n, validations: n, disputes: n, withdrawn: n, accepted: n });   // n = z.number().int().nonnegative()
```

- [ ] Tests (kind required; `to` before `from` is accepted by the schema — the API answers an empty page); implement; export; build; commit — `feat(contracts): contributions (RFC-71)`.

---

### Task 3: Migration and indexes

- [ ] `0026_contributions.sql` (custom): insert the permission; manager row; `CREATE INDEX record_annotations_actor_idx ON record_annotations (actor_id, id DESC);` `CREATE INDEX trait_records_created_by_idx ON trait_records (created_by, id DESC) WHERE created_by IS NOT NULL;`. Mirror both indexes in the Drizzle schema files so `db:generate` stays clean (`index(...).on(t.actorId, t.id.desc())`, partial with `.where`). Test: `pg_indexes` lists both. Commit — `feat(db): contributions.read and per-user indexes (RFC-71 R4)`.

---

### Task 4: Service and routes

**Interfaces:**

```ts
export async function listContributions(db, visibility, userId, input: ListContributionsQuery & { limit }): Promise<{ data: ContributionRecord[] | ContributionAnnotation[]; nextCursor }>
export async function contributionSummary(db, userId): Promise<ContributionSummary>
```

Routes: `apps/api/src/http/routes/contributions.ts` mounted with `app.route('/me', contributionRoutes(ctx))` in `app.ts` (Hono accepts several routers on one prefix; `meRoutes` keeps its self-service routes) — `GET /me/contributions`, `GET /me/contributions/summary` (`dataset.read`); and, in `routes/admin/users.ts`, `GET /:id/contributions`, `GET /:id/contributions/summary` (`contributions.read`; 404 `USER_NOT_FOUND`) — the per-user routes live under `/api/admin/users/:id` like every other one (RFC-50). Append the four to the meta-test list.

- [ ] **Step 1: Failing tests** — records of user A only (B's absent), newest first, keyset; filters `traitId`, `speciesId`, `review: 'disputed'`, `intent: 'contest'`, `intent: 'none'`, `from`/`to` (UTC day bounds inclusive); `isAccepted` true after `createAcceptedValue`; `responseCount`; annotations with `record` items and `reference`; summary counts on a synthetic set (2 records, 1 contest, 1 complement, 3 confirms, 1 dispute, 1 withdrawn, 1 accepted); visibility: A's record on an inactive species omitted for `RESTRICTED` but counted in the summary; the other-user route by permission.
- [ ] **Step 2: Implement** — records: `itemQuery(db).where(and(eq(traitRecords.createdBy, userId), eq(traitRecords.origin, 'manual'), speciesVisible, traitVisible, …filters))` with `isAccepted` as a correlated `exists (select 1 from (select decision, record_id from accepted_values a where a.species_id = r.species_id and a.trait_id = r.trait_id order by a.id desc limit 1) cur where cur.decision = 'accepted' and cur.record_id = r.id)` — never `max(id)`: there is no `max(uuid)` in PostgreSQL (`docs/gotchas/dataset.md`) and `responseCount` as `(select count(*) from trait_records x where x.responds_to_record_id = r.id)`; annotations: `select` from `record_annotations` joined to the `itemQuery` select (use it as a subquery `.as('rec')`); summary: seven small counts.
- [ ] **Step 3: Commit** — `feat(api): my contributions and summary; any user's with contributions.read (RFC-71 R1-R5)`.

---

### Task 5: Web

- [ ] **Step 1: Failing tests** — nav entry "My contributions" with `dataset.read`; page: summary tiles (`StatTiles` renders `label`/`value` pairs), tabs Records / Annotations (URL `?kind=`), `ContributionFilters` (trait select from the dictionary, species combobox over `searchSpecies`, review select, intent select, from/to date inputs; URL params), the records tab renders a `RecordTable` plus a status column (review badge, "accepted" green badge, contest/complement badge) and opens `RecordDrawer` on a row; the annotations tab (`AnnotationTable`: kind badge, "automatic" when `generated`, date, species › trait, note, "supported by <label>"); with `?userId=` and `contributions.read` the page titles "Contributions of <name>" (name from `fetchUser` when `users.read`, else the first item's `createdBy.name`, else the id) and calls the user routes; the user page shows "View contributions" linking to `/app/contributions?userId=`.
- [ ] **Step 2: Implement** (`api/contributions.ts`: `contributionKeys`, `fetchMyContributions`, `fetchMySummary`, `fetchUserContributions`, `fetchUserSummary`; `Icon` `user` glyph).
- [ ] **Step 3: Commit** — `feat(web): My contributions page (RFC-71)`.

---

### Task 6: Close-out

- [ ] RFC-71 → accepted; spec status; E2E: after the contribution flow of plan 09b, the contributor's My contributions lists the record and the validation. Full checks; PR `feat: my contributions (plan 11a)`; one CodeRabbit run.

## Self-review

- Spec §3 R1–R6 → Tasks 2–5; §6 permission → Tasks 1, 3; §7 tests → Tasks 4–5.
