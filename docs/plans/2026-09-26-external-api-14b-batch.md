# External API 14b — Batch endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A script holding an admin API key sends up to 500 operations in one `POST /api/batch` and gets one result per operation, each produced by the same route, schema, guard and authorship as a single call.

**Architecture:** The batch route replays every operation as an internal `Request` through the root Hono app (`root.fetch`) with the caller's own `Authorization` header, so every middleware and route runs unchanged and each operation commits on its own. An `AsyncLocalStorage` marks those internal requests so the global limiter does not charge them twice: the batch reserves the whole cost (one unit per operation) up front, atomically, through a new `cost` argument on the limiter. A fourth guard class, `apiKey`, lets the route refuse cookie sessions and keeps the RFC-32 meta-test exhaustive.

**Tech Stack:** Hono 4, Redis (Lua sliding window), Zod 4, Vitest 5 + testcontainers, Playwright.

**Spec:** `docs/specs/2026-09-26-external-api-design.md` (§3, R-10–R-15). Rules land as RFC-82 R10–R15.

## Global Constraints

- Node 24.21.0 and pnpm 12.4.1 from asdf: prefix every command with `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH`.
- Work only in the worktree `.worktrees/external-api-batch` (branch `feat/external-api-batch`). Never `checkout -b` in the main checkout.
- RFC → failing test → code (RFC-00, RFC-01). Every exported symbol in `apps/*/src` and `packages/*/src` carries `@rfc RFC-NN Rx`.
- No database mocks. Integration tests use `useTestApp()` from `apps/api/test/helpers/app.ts`.
- English everywhere: code, comments, docs, UI, commits.
- Batch size: 1 to 500 operations (`BATCH_MAX_OPS = 500`). Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Key rate limit (unchanged): 3000 units per 10 minutes per key, bucket `global:api_key`. A batch of `n` operations costs exactly `n` units.
- No migration in this plan.
- Parallel tasks share one worktree: **subagents never run `git commit` or `git add`**; they report the files they touched and the controller commits each task (or wave) itself. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PC93e8ZuvRNV2Enn9jjW4y
  ```

## Execution waves

| Wave | Tasks (run in parallel inside a wave) | Depends on |
|---|---|---|
| 1 | Task 1 (RFC and docs), Task 2 (limiter cost), Task 3 (contracts) | — |
| 2 | Task 4 (guard class, route, dispatch) | 2, 3 (and 1 for `rfc:check`) |
| 3 | Task 5 (E2E) | 4 |

Review: implementer self-review per task, no reviewer subagents; one CodeRabbit run on the local branch before the PR.

## Decisions taken in this plan (amend the spec in Task 1)

1. **Envelope.** The response is `{ data: { summary, results } }` (RFC-11 R2), not a bare `{ summary, results }` as spec R-13 wrote it.
2. **Cost accounting.** The batch request itself already costs one unit in `globalRateLimit`; the route reserves the other `n − 1` in one atomic call before running anything, and internal operations are not charged again. Total: `n`. A body that fails validation costs the one unit of its call.
3. **Guard class.** `POST /api/batch` carries `requireApiKey`, a new guard kind `apiKey`, listed in `API_KEY_ROUTES`. RFC-32 R5 gains the fourth class.
4. **Non-JSON answers.** An operation whose route answers something other than `application/json` (the ZIP export, a map file) gets `body: null`; its stream is cancelled. `status` is kept.
5. **Per-item refusals** (R-12) answer `status: 400` with the RFC-11 R3 error body, code `VALIDATION_FAILED`, `details: [{ path: 'path' | 'body', message }]`. Refused: a path that does not start with `/api/`, a path whose normalised form leaves `/api/`, `/api/batch` itself, any self-service route (RFC-32 R5), and a `GET` with a `body`.
6. **`ref`** is echoed as given, `null` when absent.
7. **E2E.** The E2E stack has no import, so no pending group exists there. The E2E sends a batch of catalog writes (a family create, its duplicate, a nested batch) and sees the family on `/app/taxa`; the pending-map-in-a-batch case is an integration test.

## Review Focus

1. **Path tricks** — `/api/../api/auth/me`, `/api/%2e%2e/auth/me`, `//evil.test/api/x`: the checks run on the normalised pathname and the request is dispatched to that same normalised URL, so what is checked is what runs. Pinned in Task 4 (R12 test).
2. **Double charging** — an internal operation must not hit `global:api_key` again, or a 3000-unit budget would allow only 1500 operations. Pinned in Task 4 (R14 test counts the bucket).
3. **A key revoked while a batch runs** — each internal request re-resolves the key, so the remaining operations answer 401 each. Not pinned (no route a key can reach revokes a key); the behaviour follows from `resolveSession`.
4. **A cookie plus a key on `/api/batch`** — refused by `resolveSession` (RFC-82 R4) before the route; a cookie alone gets 401 from `requireApiKey`. Pinned in Task 4.
5. **One failing operation throwing** — a route error becomes that item's `status`/`body` through the root `onError`; the loop never aborts. Pinned in Task 4 (R11 independence test).

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/rfc/80-integrations/82-external-api.md` | R10–R15 |
| `docs/rfc/30-access/32-authorization-enforcement.md` | R5: the API-key class |
| `docs/rfc/20-auth/24-rate-limiting.md` | R1: cost; R4: batch accounting |
| `docs/specs/2026-09-26-external-api-design.md` | Amendment line (decisions above) |
| `CLAUDE.md` | One line on `POST /api/batch` in the API-keys bullet |
| `apps/api/src/auth/rate-limit.ts` | `hit(…, cost = 1)` |
| `packages/contracts/src/batch.ts` (new), `packages/contracts/src/index.ts` | Batch schemas |
| `apps/api/src/http/guards.ts` | `GuardKind` gains `apiKey` |
| `apps/api/src/http/api-key-routes.ts` (new) | `API_KEY_ROUTES` |
| `apps/api/src/http/batch-dispatch.ts` (new) | The `AsyncLocalStorage` marking internal operations |
| `apps/api/src/http/middleware/rate-limit.ts` | Skip internal operations |
| `apps/api/src/http/middleware/session.ts` | `requireApiKey` |
| `apps/api/src/http/routes/batch.ts` (new) | Route, refusal rules, dispatch |
| `apps/api/src/app.ts` | Mount `/batch` |
| `apps/api/test/helpers/api-keys.ts` (new) | `createAdminKey` |
| `apps/api/src/http/routes/batch.integration.test.ts` (new) | Behaviour |
| `apps/api/src/routes-guarded.integration.test.ts` | Fourth class |
| `apps/e2e/tests/critical-flow.spec.ts` | End-to-end step |

---

### Task 1: RFC-82 R10–R15 and cross-references

**Files:**
- Modify: `docs/rfc/80-integrations/82-external-api.md`
- Modify: `docs/rfc/30-access/32-authorization-enforcement.md`
- Modify: `docs/rfc/20-auth/24-rate-limiting.md`
- Modify: `docs/specs/2026-09-26-external-api-design.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: rule ids `RFC-82 R10`–`R15`, `RFC-32 R5` (API-key class), `RFC-24 R1` (cost) that Tasks 2–4 cite in `@rfc` tags.

- [ ] **Step 1: Add R10–R15 to RFC-82**, after R9, exactly:

```markdown
- **R10** `POST /api/batch` takes `{ ops: [{ ref?, method, path, body? }] }`: 1 to 500 operations; `ref` a string of 1–200 characters, `method` one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `path` a string of 1–2048 characters. It is reached with a key only: a cookie session, or no credential, answers 401 `AUTH_UNAUTHENTICATED` (RFC-32 R5, API-key class).
- **R11** Operations run in input order, one at a time. Each is dispatched to the same application as a request of its own carrying the caller's `Authorization`, `User-Agent` and `X-Forwarded-For` headers, and `Content-Type: application/json` with the JSON-encoded `body` when one is given, so it passes the same middleware, route, schema, permission guard, rules, audit and authorship as a single call, and commits on its own. A failing operation does not stop or undo the others.
- **R12** An operation is refused without being dispatched, with `status` 400 and a `VALIDATION_FAILED` body, when its `path` does not start with `/api/`, its normalised pathname (dot segments resolved) does not start with `/api/`, it targets `/api/batch`, it targets a self-service route (RFC-32 R5), or it is a `GET` with a `body`. The pathname checked is the one dispatched.
- **R13** The batch answers 200 with `{ data: { summary: { ok, failed }, results: [{ ref, status, body }] } }`, one result per operation in input order; `ref` is echoed, `null` when absent. `status` and `body` are what the route answered, errors included (RFC-12); a response that is not `application/json` gives `body: null`. `ok` counts results with a 2xx status, `failed` the others.
- **R14** A batch of `n` operations costs `n` units of the key's `global:api_key` bucket (R9): the request itself counts as the first, and the route reserves the other `n − 1` in one atomic step before any operation runs; when they do not fit, the whole batch answers 429 `RATE_LIMITED` and nothing runs. Dispatched operations are not counted again.
- **R15** Re-sending a batch creates no duplicate records: mapping an already mapped pending group creates nothing, and a catalog create that collides answers the same duplicate error as a single call (for example 409 `FAMILY_NAME_TAKEN`). An operation cannot use an id created by an earlier operation of the same batch; a script sends two batches.
```

Add to its Changelog:

```markdown
- 2026-09-26 — R10–R15: the batch endpoint (plan 14b). The response uses the RFC-11 R2 envelope; a batch of n operations costs n units.
```

- [ ] **Step 2: RFC-32 R5.** Replace the sentence "Every registered route is exactly one of: public (RFC-22 R1), self-service — behind `requireSession` only —, or permission-guarded — behind `requirePermission`." with "Every registered route is exactly one of: public (RFC-22 R1), self-service — behind `requireSession` only —, API-key — behind `requireApiKey` only, reached with an API key and never a session: `POST /api/batch` (RFC-82 R10) —, or permission-guarded — behind `requirePermission`." and replace "Every route that is neither public nor in the self-service list is permission-guarded" with "Every route that is neither public, self-service nor API-key is permission-guarded". Changelog: `- 2026-09-26 — R5: the API-key class, for POST /api/batch (RFC-82 R10, plan 14b).`

- [ ] **Step 3: RFC-24.** In R1 (the limiter rule) append: "A hit may carry a cost: it is admitted only when the current count plus the cost fits the limit, and then records that many units; otherwise it records none." In R4 append: "An operation dispatched by `POST /api/batch` is not counted: the batch has already paid for it (RFC-82 R14)." Changelog: `- 2026-09-26 — R1: a hit may cost more than one unit; R4: batch operations are paid by the batch (RFC-82 R14, plan 14b).` Read R1 first and fit the sentence to its wording.

- [ ] **Step 4: Spec amendment.** Append to the `**Amendments:**` line of `docs/specs/2026-09-26-external-api-design.md`: " 2026-09-26 (plan 14b): the batch answers inside the RFC-11 R2 envelope, `{ data: { summary, results } }`; the batch request counts as its first operation, so a batch of n costs n units; `POST /api/batch` is a fourth guard class (API-key, RFC-32 R5); a non-JSON answer gives `body: null`; a `GET` with a body is refused per item; the E2E sends catalog writes, because the E2E stack has no pending group."

- [ ] **Step 5: CLAUDE.md.** In the "API keys" bullet under Commands, after "…revoke every key of the user", insert: "; `POST /api/batch` (key only) runs 1–500 operations through the same routes, each committing on its own, and answers one result per operation" — keep the trailing ": RFC-82." reference.

- [ ] **Step 6: Report** the five files to the controller (no commit). Controller commits: `docs(rfc): RFC-82 R10-R15 batch endpoint (plan 14b)`.

---

### Task 2: Limiter hits with a cost

**Files:**
- Modify: `apps/api/src/auth/rate-limit.ts`
- Test: `apps/api/src/auth/rate-limit.integration.test.ts`

**Interfaces:**
- Produces: `RateLimiter.hit(scope: string, key: string, rule: RateLimitRule, cost?: number): Promise<RateLimitDecision>` — `cost` defaults to 1; admitted when `count + cost <= limit`, then records `cost` members; refused records nothing.

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('RFC-24 R1, R2 sliding window limiter', …)`:

```ts
  it('RFC-24 R1 a hit with a cost records that many units, or none when they do not fit', async () => {
    const limiter = createRateLimiter(redis, () => clock.now);
    const rule = { limit: 5, windowMs: 60_000 };
    const k = key();
    expect(await limiter.hit('t', k, rule, 3)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(await redis.zcard(`rl:t:${k}`)).toBe(3);
    clock.now += 1000;
    const refused = await limiter.hit('t', k, rule, 3);
    expect(refused.allowed).toBe(false);
    // One unit must leave the window: the oldest, recorded 1 s ago.
    expect(refused.retryAfterSeconds).toBe(59);
    expect(await redis.zcard(`rl:t:${k}`)).toBe(3);
    expect((await limiter.hit('t', k, rule, 2)).allowed).toBe(true);
    expect(await redis.zcard(`rl:t:${k}`)).toBe(5);
  });

  it('RFC-24 R1 a refused cost waits for as many units as it lacks', async () => {
    const limiter = createRateLimiter(redis, () => clock.now);
    const rule = { limit: 3, windowMs: 60_000 };
    const k = key();
    for (let i = 0; i < 3; i++) {
      await limiter.hit('t', k, rule);
      clock.now += 10_000;
    }
    // Needs 2 free units: the second oldest (recorded 20 s ago) must leave.
    const refused = await limiter.hit('t', k, rule, 2);
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });

  it('RFC-24 R1 a cost above the limit is refused with the whole window as the wait', async () => {
    const limiter = createRateLimiter(redis, () => clock.now);
    expect(await limiter.hit('t', key(), { limit: 2, windowMs: 60_000 }, 3)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts apps/api/src/auth/rate-limit.integration.test.ts`
Expected: the three new tests FAIL (cost ignored: `zcard` is 1, not 3).

- [ ] **Step 3: Implement.** In `apps/api/src/auth/rate-limit.ts`:

Interface:

```ts
export interface RateLimiter {
  /** `cost` units are recorded together, or none (RFC-24 R1); default 1. */
  hit(scope: string, key: string, rule: RateLimitRule, cost?: number): Promise<RateLimitDecision>;
}
```

Script (replace `HIT_SCRIPT` and its comment):

```ts
// KEYS[1] = sorted set; ARGV = now(ms), window(ms), limit, member, cost.
// Admits when count + cost fits the limit and records `cost` members;
// otherwise records nothing and returns the wait until enough units leave.
// Returns {allowed(0|1), retryAfter(ms)}.
const HIT_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cost = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count + cost > limit then
  if cost > limit then return {0, window} end
  local lacking = count + cost - limit
  local nth = redis.call('ZRANGE', KEYS[1], lacking - 1, lacking - 1, 'WITHSCORES')
  return {0, tonumber(nth[2]) + window - now}
end
for i = 1, cost do
  redis.call('ZADD', KEYS[1], now, ARGV[4] .. ':' .. i)
end
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`;
```

Implementation:

```ts
/** @rfc RFC-24 R1, R2 */
export function createRateLimiter(redis: Redis, now: () => number = Date.now): RateLimiter {
  return {
    async hit(scope, key, rule, cost = 1) {
      const t = now();
      const member = `${t}-${randomBytes(4).toString('hex')}`;
      const result = (await redis.eval(
        HIT_SCRIPT,
        1,
        `rl:${scope}:${key}`,
        String(t),
        String(rule.windowMs),
        String(rule.limit),
        member,
        String(cost),
      )) as [number, number];
      if (result[0] === 1) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(result[1] / 1000)) };
    },
  };
}
```

(With `cost = 1` and `count = limit`, `lacking = 1` reads the oldest member, as before.)

- [ ] **Step 4: Run the whole file** (same command). Expected: every test PASS, old ones included.

- [ ] **Step 5: Report** the two files to the controller. Controller commits: `feat(api): rate limiter hits with a cost (RFC-24 R1)`.

---

### Task 3: Batch contracts

**Files:**
- Create: `packages/contracts/src/batch.ts`
- Create: `packages/contracts/src/batch.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces (from `@treerepro/contracts`): `BATCH_MAX_OPS` (500), `BATCH_METHODS`, `batchOpSchema`, `batchBodySchema`, `batchResultSchema`, `batchResponseSchema`, types `BatchOp`, `BatchResult`, `BatchResponse`.

- [ ] **Step 1: Write the failing test** `packages/contracts/src/batch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BATCH_MAX_OPS, batchBodySchema } from './batch.ts';

const op = { method: 'GET', path: '/api/families' } as const;

describe('RFC-82 R10 batch body', () => {
  it('takes 1 to 500 operations', () => {
    expect(batchBodySchema.safeParse({ ops: [] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [op] }).success).toBe(true);
    expect(batchBodySchema.safeParse({ ops: Array(BATCH_MAX_OPS).fill(op) }).success).toBe(true);
    expect(batchBodySchema.safeParse({ ops: Array(BATCH_MAX_OPS + 1).fill(op) }).success).toBe(
      false,
    );
  });

  it('accepts ref and any JSON body, refuses unknown fields and methods', () => {
    expect(
      batchBodySchema.safeParse({
        ops: [{ ref: 'row-1', method: 'POST', path: '/api/families', body: { name: 'X' } }],
      }).success,
    ).toBe(true);
    expect(batchBodySchema.safeParse({ ops: [{ ...op, extra: 1 }] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [{ ...op, method: 'HEAD' }] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [op], extra: 1 }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [{ ...op, ref: '' }] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ops: [{ ...op, path: '' }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts packages/contracts/src/batch.test.ts`
Expected: FAIL, module `./batch.ts` not found.

- [ ] **Step 3: Implement** `packages/contracts/src/batch.ts`:

```ts
import { z } from 'zod';

/** @rfc RFC-82 R10 */
export const BATCH_MAX_OPS = 500;

/** @rfc RFC-82 R10 */
export const BATCH_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** @rfc RFC-82 R10 */
export const batchOpSchema = z.strictObject({
  ref: z.string().min(1).max(200).optional(),
  method: z.enum(BATCH_METHODS),
  path: z.string().min(1).max(2048),
  body: z.unknown().optional(),
});

/** @rfc RFC-82 R10 */
export const batchBodySchema = z.strictObject({
  ops: z.array(batchOpSchema).min(1).max(BATCH_MAX_OPS),
});

/** @rfc RFC-82 R13 */
export const batchResultSchema = z.strictObject({
  ref: z.string().nullable(),
  status: z.number().int(),
  body: z.unknown(),
});

/** @rfc RFC-82 R13 */
export const batchResponseSchema = z.strictObject({
  summary: z.strictObject({
    ok: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  results: z.array(batchResultSchema),
});

export type BatchOp = z.infer<typeof batchOpSchema>;
export type BatchResult = z.infer<typeof batchResultSchema>;
export type BatchResponse = z.infer<typeof batchResponseSchema>;
```

Add `export * from './batch.ts';` to `packages/contracts/src/index.ts`, in alphabetical position among the existing `export *` lines (after `audit`).

- [ ] **Step 4: Run** the test (same command) — PASS — then `PATH=… pnpm --filter @treerepro/contracts build` so `apps/api` sees the new exports (check `packages/contracts/package.json` for the build script name; skip if contracts is consumed from source).

- [ ] **Step 5: Report** the three files. Controller commits: `feat(contracts): batch body and response schemas (RFC-82 R10, R13)`.

---

### Task 4: `POST /api/batch`

**Files:**
- Modify: `apps/api/src/http/guards.ts`
- Create: `apps/api/src/http/api-key-routes.ts`
- Create: `apps/api/src/http/batch-dispatch.ts`
- Modify: `apps/api/src/http/middleware/rate-limit.ts`
- Modify: `apps/api/src/http/middleware/session.ts`
- Create: `apps/api/src/http/routes/batch.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/helpers/api-keys.ts`
- Create: `apps/api/src/http/routes/batch.integration.test.ts`
- Modify: `apps/api/src/routes-guarded.integration.test.ts`

**Interfaces:**
- Consumes: `RateLimiter.hit(scope, key, rule, cost)` (Task 2); `batchBodySchema`, `BatchOp`, `BatchResult` from `@treerepro/contracts` (Task 3); `SELF_SERVICE_ROUTES`, `errorBody`, `RateLimitedError`, `validate`, `markGuard`, `RATE_LIMITS`, `AuthContext` (existing).
- Produces: `requireApiKey` (guard kind `'apiKey'`), `API_KEY_ROUTES`, `batchDispatch` (`AsyncLocalStorage<true>`), `batchRoutes(ctx, dispatch)`, `batchRefusal(op)`, test helper `createAdminKey(t)`.

- [ ] **Step 1: Test helper** `apps/api/test/helpers/api-keys.ts`:

```ts
import { generateApiKey } from '../../src/auth/api-keys.ts';
import { hashToken } from '../../src/auth/tokens.ts';
import { apiKeys } from '../../src/db/schema/api-keys.ts';
import type { TestApp } from './app.ts';
import { adminRoleId } from './roles.ts';
import { createUser } from './users.ts';

/** An admin and a usable key of theirs, valid for a day on the test clock. */
export async function createAdminKey(t: TestApp) {
  const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
  const raw = generateApiKey();
  const [key] = await t.db
    .insert(apiKeys)
    .values({
      userId: user.id,
      name: 'batch',
      keyHash: hashToken(raw),
      keyPrefix: raw.slice(8, 16),
      expiresAt: new Date(t.clock.now + 86_400_000),
    })
    .returning();
  if (!key) throw new Error('createAdminKey: insert returned no row');
  return { user, raw, key, headers: { authorization: `Bearer ${raw}` } };
}
```

- [ ] **Step 2: Write the failing behaviour tests** `apps/api/src/http/routes/batch.integration.test.ts`:

```ts
import { and, eq, isNotNull, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAdminKey } from '../../../test/helpers/api-keys.ts';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { lastAudit } from '../../../test/helpers/audit.ts';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../test/helpers/dataset.ts';
import { adminRoleId } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { RATE_LIMITS } from '../../auth/rate-limit.ts';
import { traitRecords } from '../../db/schema/records.ts';
import { families } from '../../db/schema/taxa.ts';

const ZERO = '00000000-0000-0000-0000-000000000000';
const rand = () => Math.random().toString(36).slice(2, 8);

describe('RFC-82 R10-R15 POST /api/batch', () => {
  const t = useTestApp();
  const batch = (headers: Record<string, string>, ops: unknown[]) =>
    call(t.app, 'POST', '/api/batch', { headers, origin: null, body: { ops } });

  it('R10 refuses a cookie session and an anonymous caller with 401', async () => {
    const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const { cookie } = await loginAs(t, user);
    const ops = [{ method: 'GET', path: '/api/families' }];
    const withCookie = await call(t.app, 'POST', '/api/batch', { cookie, body: { ops } });
    expect(withCookie.status).toBe(401);
    expect((await withCookie.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
    const anonymous = await call(t.app, 'POST', '/api/batch', { body: { ops } });
    expect(anonymous.status).toBe(401);
  });

  it('R10 refuses an empty batch, more than 500 operations and unknown fields with 400', async () => {
    const { headers } = await createAdminKey(t);
    const op = { method: 'GET', path: '/api/families' };
    for (const ops of [[], Array(501).fill(op), [{ ...op, extra: true }]]) {
      const res = await batch(headers, ops);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('R11, R13 runs in order, keeps going past a failure and answers what each route answers', async () => {
    const { user, key, headers } = await createAdminKey(t);
    const name = `Batchaceae-${rand()}`;
    const res = await batch(headers, [
      { ref: 'a', method: 'POST', path: '/api/families', body: { name } },
      { ref: 'b', method: 'POST', path: '/api/families', body: {} },
      { method: 'POST', path: '/api/families', body: { name } },
      { ref: 'd', method: 'GET', path: `/api/records/${ZERO}` },
    ]);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.summary).toEqual({ ok: 1, failed: 3 });
    expect(data.results.map((r: { ref: string | null }) => r.ref)).toEqual(['a', 'b', null, 'd']);
    expect(data.results.map((r: { status: number }) => r.status)).toEqual([201, 400, 409, 404]);
    expect(data.results[0].body.data).toEqual({ id: expect.any(String), name });
    expect(data.results[1].body.error.code).toBe('VALIDATION_FAILED');
    // R15: the duplicate answers exactly the single-call duplicate error.
    expect(data.results[2].body.error.code).toBe('FAMILY_NAME_TAKEN');
    const direct = await call(t.app, 'GET', `/api/records/${ZERO}`, { headers, origin: null });
    expect(data.results[3].body).toEqual(await direct.json());
    // R11: same audit and authorship as a single call made with the key.
    expect(
      await lastAudit(t.db, 'taxa.created', { targetId: data.results[0].body.data.id }),
    ).toMatchObject({ actorUserId: user.id, metadata: { via: 'api_key', apiKeyId: key.id } });
  });

  it('R11, R15 maps a pending group with the key owner as author; re-sending creates nothing', async () => {
    const { user, headers } = await createAdminKey(t);
    const species = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['red', 'blue'] });
    const ref = await createReference(t.db);
    const importBatch = await createImportBatch(t.db);
    const pending = [];
    for (let i = 0; i < 2; i++) {
      pending.push(
        await createRecord(t.db, {
          speciesId: species.id,
          traitId: trait.id,
          valueText: 'reds',
          primaryReferenceId: ref.id,
          importBatchId: importBatch.id,
          harmonisation: 'unknown_level',
        }),
      );
    }
    const red = trait.levels[0]?.id ?? '';
    const ops = [
      {
        method: 'POST',
        path: '/api/records/pending/map',
        body: { traitId: trait.id, valueText: 'reds', value: { levelIds: [red] } },
      },
    ];
    const first = await (await batch(headers, ops)).json();
    expect(first.data.results[0]).toMatchObject({ status: 200, body: { data: { created: 2 } } });
    const mapped = await t.db
      .select({ createdBy: traitRecords.createdBy })
      .from(traitRecords)
      .where(
        and(eq(traitRecords.traitId, trait.id), isNotNull(traitRecords.supersedesRecordId)),
      );
    expect(mapped).toEqual([{ createdBy: user.id }, { createdBy: user.id }]);
    await batch(headers, ops);
    const after = await t.db
      .select({ id: traitRecords.id })
      .from(traitRecords)
      .where(eq(traitRecords.traitId, trait.id));
    expect(after).toHaveLength(4);
  });

  it('R12 refuses forbidden paths per item and still runs the rest', async () => {
    const { headers } = await createAdminKey(t);
    const refused = [
      { method: 'GET', path: '/health' },
      { method: 'GET', path: 'api/families' },
      { method: 'GET', path: '//evil.test/api/families' },
      { method: 'GET', path: '/api/../auth/me' },
      { method: 'GET', path: '/api/%2e%2e/api/auth/me' },
      { method: 'POST', path: '/api/batch', body: { ops: [] } },
      { method: 'GET', path: '/api/auth/me' },
      { method: 'POST', path: '/api/me/api-keys', body: {} },
      { method: 'DELETE', path: `/api/me/sessions/${ZERO}` },
      { method: 'GET', path: '/api/help/some-slug' },
      { method: 'GET', path: '/api/families', body: {} },
    ];
    const res = await batch(headers, [...refused, { method: 'GET', path: '/api/families' }]);
    const { data } = await res.json();
    expect(data.summary).toEqual({ ok: 1, failed: refused.length });
    for (const result of data.results.slice(0, refused.length)) {
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(data.results.at(-1).status).toBe(200);
  });

  it('R13 gives body null for a response that is not JSON', async () => {
    const { headers } = await createAdminKey(t);
    // The export streams a ZIP (RFC-66); the admin key holds `dataset.export`.
    const res = await batch(headers, [{ method: 'GET', path: '/api/export/dataset.zip' }]);
    const { data } = await res.json();
    expect(data.results[0]).toEqual({ ref: null, status: 200, body: null });
    expect(data.summary).toEqual({ ok: 1, failed: 0 });
  });

  it('R14 a batch of n costs n units and is refused whole when they do not fit', async () => {
    const { key, headers } = await createAdminKey(t);
    const bucket = `rl:global:api_key:${key.id}`;
    const name = `Limitaceae-${rand()}`;
    const ops = [0, 1, 2].map((i) => ({
      method: 'POST',
      path: '/api/families',
      body: { name: `${name}-${i}` },
    }));
    expect((await batch(headers, ops)).status).toBe(200);
    expect(await t.redis.zcard(bucket)).toBe(3);

    // Leave 3 units: a 4-operation batch pays 1 for its call, then lacks 1.
    const { limit } = RATE_LIMITS.apiKey;
    await t.limiter.hit('global:api_key', key.id, RATE_LIMITS.apiKey, limit - 6);
    const refused = await batch(headers, [
      ...[0, 1, 2].map((i) => ({
        method: 'POST',
        path: '/api/families',
        body: { name: `${name}-late-${i}` },
      })),
      { method: 'GET', path: '/api/families' },
    ]);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe('RATE_LIMITED');
    // The refused batch created nothing. Checked in the database, not through
    // the API, so no unit is spent between the two batches.
    const late = await t.db
      .select({ id: families.id })
      .from(families)
      .where(like(families.name, `${name}-late-%`));
    expect(late).toEqual([]);
    // The refused call cost 1: 2 units left, and a 2-operation batch fits exactly.
    const fits = await batch(headers, [
      { method: 'GET', path: '/api/families' },
      { method: 'GET', path: '/api/families' },
    ]);
    expect(fits.status).toBe(200);
    expect(await t.redis.zcard(bucket)).toBe(limit);
  });
});
```

R14 arithmetic: after the first batch the bucket holds 3; the direct `hit` adds `limit − 6`, leaving 3. The refused 4-operation batch pays 1 for its call (2 left) and cannot reserve 3. The 2-operation batch pays 1 and reserves 1: the bucket is full. Nothing else in that test may call the API with the key between those steps.

- [ ] **Step 3: Run them to see them fail**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts apps/api/src/http/routes/batch.integration.test.ts`
Expected: FAIL — `POST /api/batch` answers 404 `NOT_FOUND`.

- [ ] **Step 4: Guard kind and route list.** `apps/api/src/http/guards.ts`: `export type GuardKind = 'session' | 'permission' | 'apiKey';` and add `@rfc RFC-32 R5` to `markGuard`'s JSDoc. New `apps/api/src/http/api-key-routes.ts`:

```ts
/**
 * Routes reached with an API key only, never a session, as
 * `"<METHOD> <path>"`; each carries `requireApiKey` and nothing else.
 * @rfc RFC-32 R5
 * @rfc RFC-82 R10
 */
export const API_KEY_ROUTES: readonly string[] = ['POST /api/batch'];
```

- [ ] **Step 5: `requireApiKey`** — in `apps/api/src/http/middleware/session.ts`, after `requireSession`:

```ts
/**
 * @rfc RFC-32 R5
 * @rfc RFC-82 R10
 */
export const requireApiKey: MiddlewareHandler<AppEnv> = markGuard(async (c, next) => {
  if (!c.get('apiKey')) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
  await next();
}, 'apiKey');
```

- [ ] **Step 6: Internal-operation marker** `apps/api/src/http/batch-dispatch.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

/** Set while `POST /api/batch` dispatches one of its operations. @rfc RFC-82 R14 */
export const batchDispatch = new AsyncLocalStorage<true>();
```

In `globalRateLimit` (`apps/api/src/http/middleware/rate-limit.ts`), first line of the handler after the health exemption:

```ts
    // RFC-82 R14: the batch paid for its operations before dispatching them.
    if (batchDispatch.getStore()) return next();
```

and add `@rfc RFC-82 R14` to its JSDoc.

- [ ] **Step 7: The route** `apps/api/src/http/routes/batch.ts`:

```ts
import { type BatchOp, type BatchResult, batchBodySchema } from '@treerepro/contracts';
import { type Context, Hono } from 'hono';
import type { AuthContext } from '../../auth/context.ts';
import { RATE_LIMITS } from '../../auth/rate-limit.ts';
import { batchDispatch } from '../batch-dispatch.ts';
import type { AppEnv } from '../env.ts';
import { errorBody, RateLimitedError } from '../errors.ts';
import { requireApiKey } from '../middleware/session.ts';
import { SELF_SERVICE_ROUTES } from '../self-service-routes.ts';
import { validate } from '../validate.ts';

// Any host works: the URL only carries the path to the same application.
const BASE = 'http://batch.internal';
const FORWARDED = ['authorization', 'user-agent', 'x-forwarded-for'] as const;

const SELF_SERVICE = SELF_SERVICE_ROUTES.map((route) => {
  const [method, path] = route.split(' ') as [string, string];
  return { method, pattern: new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`) };
});

/**
 * Why an operation may not run, or the normalised URL it runs at.
 * @rfc RFC-82 R12
 */
export function batchRefusal(op: BatchOp): { reason: string; field: 'path' | 'body' } | { url: URL } {
  if (!op.path.startsWith('/api/')) return { reason: 'Path must start with /api/', field: 'path' };
  // Resolves dot segments (also percent-encoded ones); what is checked is what runs.
  const url = new URL(op.path, BASE);
  const path = url.pathname;
  if (url.origin !== BASE || !path.startsWith('/api/'))
    return { reason: 'Path must stay under /api/', field: 'path' };
  if (path === '/api/batch' || path.startsWith('/api/batch/'))
    return { reason: 'A batch cannot contain a batch', field: 'path' };
  if (SELF_SERVICE.some((r) => r.method === op.method && r.pattern.test(path)))
    return { reason: 'Account routes need a session', field: 'path' };
  if (op.method === 'GET' && op.body !== undefined)
    return { reason: 'A GET operation takes no body', field: 'body' };
  return { url };
}

async function run(
  c: Context<AppEnv>,
  dispatch: (request: Request) => Promise<Response>,
  op: BatchOp,
): Promise<BatchResult> {
  const ref = op.ref ?? null;
  const checked = batchRefusal(op);
  if ('reason' in checked) {
    const body = errorBody('VALIDATION_FAILED', checked.reason, [
      { path: checked.field, message: checked.reason },
    ]);
    return { ref, status: 400, body };
  }
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  const init: RequestInit = { method: op.method, headers };
  if (op.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(op.body);
  }
  const res = await batchDispatch.run(true, () => dispatch(new Request(checked.url, init)));
  if (/^application\/json\b/i.test(res.headers.get('content-type') ?? '')) {
    return { ref, status: res.status, body: await res.json() };
  }
  await res.body?.cancel();
  return { ref, status: res.status, body: null };
}

/**
 * `dispatch` is the root application's `fetch`, so each operation passes every
 * middleware and route exactly as a single call does.
 * @rfc RFC-82 R10, R11, R13, R14
 */
export function batchRoutes(ctx: AuthContext, dispatch: (request: Request) => Promise<Response>) {
  return new Hono<AppEnv>().post('/', requireApiKey, validate('json', batchBodySchema), async (c) => {
    const { ops } = c.req.valid('json');
    const apiKey = c.get('apiKey');
    // `globalRateLimit` already charged this request one unit: it is the first operation.
    if (apiKey && ops.length > 1) {
      const decision = await ctx.limiter.hit(
        'global:api_key',
        apiKey.id,
        RATE_LIMITS.apiKey,
        ops.length - 1,
      );
      if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
    }
    const results: BatchResult[] = [];
    for (const op of ops) results.push(await run(c, dispatch, op));
    const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
    return c.json({ data: { summary: { ok, failed: results.length - ok }, results } });
  });
}
```

Check `errorBody`'s return type is JSON-serialisable as `unknown` (it is `{ error: … }`) and `RateLimitedError` is exported from `../errors.ts` (it is imported that way in `middleware/rate-limit.ts`). `new URL('//evil.test/api/x', BASE)` never reaches the origin check because such a path fails `startsWith('/api/')` first; the `url.origin` test is a second lock.

- [ ] **Step 8: Mount it** in `apps/api/src/app.ts`, after `app.route('/help', …)` and before the dataset router:

```ts
  // RFC-82 R11: operations re-enter through the root, so every middleware runs for each.
  app.route('/batch', batchRoutes(ctx, (request) => Promise.resolve(root.fetch(request))));
```

Import `batchRoutes` from `./http/routes/batch.ts`; add `@rfc RFC-82 R11` to `createApp`'s JSDoc.

- [ ] **Step 9: Run the batch tests** (Step 3 command). Expected: PASS. If R12's `%2e%2e` case dispatches instead of refusing, print `new URL('/api/%2e%2e/api/auth/me', 'http://x').pathname` in a scratch `node -e` — WHATWG resolves `%2e%2e` as `..`, giving `/api/auth/me`, which the self-service check refuses.

- [ ] **Step 10: Meta-test.** In `apps/api/src/routes-guarded.integration.test.ts`:
  1. `import { API_KEY_ROUTES } from './http/api-key-routes.ts';`
  2. Guard-class test: rename to `'public routes carry no guard, self-service routes requireSession, API-key routes requireApiKey, everything else requirePermission'` and add, before the final `else`:
     ```ts
      } else if (API_KEY_ROUTES.includes(key)) {
        if (!kinds.has('apiKey') || kinds.size !== 1)
          wrong.push(`${key}: API-key routes carry requireApiKey only`);
     ```
     and in the final `else` add `if (kinds.has('apiKey')) wrong.push(\`${key}: requireApiKey outside API_KEY_ROUTES\`);`.
  3. Allowlists test: iterate `[...PUBLIC_ROUTES, ...SELF_SERVICE_ROUTES, ...API_KEY_ROUTES]` for existence, and assert the three lists are pairwise disjoint.
  4. Add `'POST /api/batch',` to the "exposes exactly" list.
  5. In the "403 PERMISSION_DENIED for a session without roles" sweep and the "permission-guarded route admits a valid admin key" sweep, `continue` on `API_KEY_ROUTES.includes(key)` as well.

- [ ] **Step 11: Full API suite, lint, types, RFC links**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm test && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm typecheck && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check`
Expected: all green. `routes-visibility.integration.test.ts` should not need a change (the batch route names no permission); if it does, skip `API_KEY_ROUTES` there the same way.

- [ ] **Step 12: Report** the files. Controller commits: `feat(api): POST /api/batch runs operations through the same routes (RFC-82 R10-R15)`.

---

### Task 5: E2E — a batch through the production stack

**Files:**
- Modify: `apps/e2e/tests/critical-flow.spec.ts`

**Interfaces:**
- Consumes: the key the RFC-82 R1–R3 test creates (hoisted to the `describe` scope as `apiSecret`), `POST /api/batch` (Task 4).

- [ ] **Step 1: Hoist the secret.** In the `describe` holding `test('RFC-82 R1-R3 creates an API key …')`, declare `let apiSecret = '';` next to the other shared `let`s, and after `expect(secret).toMatch(/^tr_live_/);` add `apiSecret = secret ?? '';`.

- [ ] **Step 2: Add the test** right after that one:

```ts
  test('RFC-82 R10-R15 sends a batch with the key and sees its effect in the workspace', async () => {
    const family = `E2ebatchaceae${Date.now()}`;
    const anonymous = await request.newContext();
    const res = await anonymous.post(`${BASE_URL}/api/batch`, {
      headers: { authorization: `Bearer ${apiSecret}` },
      data: {
        ops: [
          { ref: 'new', method: 'POST', path: '/api/families', body: { name: family } },
          { ref: 'dup', method: 'POST', path: '/api/families', body: { name: family } },
          { ref: 'nested', method: 'POST', path: '/api/batch', body: { ops: [] } },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.summary).toEqual({ ok: 1, failed: 2 });
    expect(data.results.map((r: { status: number }) => r.status)).toEqual([201, 409, 400]);
    await anonymous.dispose();

    await page.goto(`${BASE_URL}/app/taxa`);
    await expect(page.getByText(family)).toBeVisible();
  });
```

Before running, open `/app/taxa` in the running dev stack (or read its component under `apps/web/src`) to confirm a new family is listed without searching; if the page paginates or needs a search, type `family` into its search field first.

- [ ] **Step 3: Run the E2E suite**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm test:e2e`
Expected: PASS, including the new test (it runs after the key test, same serial `describe`).

- [ ] **Step 4: Report** the file. Controller commits: `test(e2e): a batch sent with an API key (RFC-82 R10-R15)`.

---

## After the tasks

1. One `coderabbit:code-review` run on the local branch; fix what holds up.
2. `git rebase origin/main`, push, PR `feat: batch endpoint POST /api/batch (plan 14b)` with `Closes #200`.
3. Issue #200 gains its **Outcome** section; epic #198's table marks 14b done with the PR.
