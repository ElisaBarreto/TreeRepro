# External API 14c — Documentation and no-drift locks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A script holding an admin API key reads a hand-written guide (`GET /api/docs`) and a generated OpenAPI reference (`GET /api/docs/openapi.json`), and CI fails whenever the API surface changes without the guide's changelog being updated.

**Architecture:** A hand-written route catalog (`route-catalog.ts`) gives every mounted route a summary and, where `packages/contracts` has one, its response schema. Everything else is read from the live app: guard class and permission from the existing `markGuard` registry, request schemas from a new registry filled by `validate()`. A pure `buildOpenApi(app.routes)` turns that into OpenAPI 3.1 with `z.toJSONSchema`; its SHA-256 is pinned in the guide's first line and checked by a test. Two API-key routes serve the guide and the document.

**Tech Stack:** Hono 4, Zod 4 (`z.toJSONSchema`), Vitest 5 + testcontainers, Playwright.

**Spec:** `docs/specs/2026-09-26-external-api-design.md` (§4, R-16–R-21). Rules land as RFC-82 R16–R21.

## Global Constraints

- Node 24.21.0 and pnpm 12.4.1 from asdf: prefix every command with `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH`.
- Work only in the worktree `/Users/rafael/Documents/Aplicativos/Elisa-14c` (branch `feat/external-api-docs`). Never `checkout -b` in the main checkout.
- RFC → failing test → code (RFC-00, RFC-01). Every exported symbol in `apps/*/src` and `packages/*/src` carries `@rfc RFC-NN Rx`.
- No database mocks. Integration tests use `useTestApp()` from `apps/api/test/helpers/app.ts`.
- English everywhere: code, comments, docs, UI, commits.
- No new dependency. No migration.
- Catalog key format: `"<METHOD> <path>"` with Hono's path syntax, exactly as `routes-guarded.integration.test.ts` builds it (e.g. `GET /api/species/:id`).
- Hash: SHA-256 hex of `JSON.stringify(buildOpenApi(app.routes))`; the guide's **first line** is `openapi-sha256: <64 hex>`.
- The `CLAUDE.md` rule planned in spec R-21 is **rule 10** (rules 8 and 9 are taken).
- Parallel tasks share one worktree: **subagents never run `git commit` or `git add`**; they report the files they touched and the controller commits each task itself. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PC93e8ZuvRNV2Enn9jjW4y
  ```

## Execution waves

| Wave | Tasks (parallel inside a wave) | Depends on |
|---|---|---|
| 1 | Task 1 (RFC and handbook), Task 2 (validator registry), Task 3 (route catalog + meta-test), Task 4 (guide prose) | — |
| 2 | Task 5 (OpenAPI generator) | 2, 3 |
| 3 | Task 6 (serving routes, hash lock, image, E2E) | 1, 4, 5 |

Review: implementer self-review per task, no reviewer subagents; one CodeRabbit run on the local branch before the PR.

## Decisions taken in this plan (amend the spec in Task 1)

1. **Derived, not repeated.** The catalog holds only what the code cannot tell: a summary and an optional response schema. Guard class, permission and request schemas are read from the mounted handlers, so they cannot drift from what runs.
2. **Response schemas only where they exist.** `packages/contracts` has response schemas for a few routes (health, auth, maps, batch, API keys, some list items). The catalog references those; other operations document `2XX` without a schema. Writing ~100 new response schemas is out of scope; the guide shows the shapes a script needs for the pending workflow.
3. **Docs routes are API-key routes.** `GET /api/docs` and `GET /api/docs/openapi.json` carry `requireApiKey` and join `API_KEY_ROUTES` (RFC-32 R5): a cookie session answers 401, as R-20 wants "a valid key only".
4. **Guide location.** `docs/api/guide.md` (spec path). The production image copies `docs/api` next to the app; the path is resolved from the module like `defaultMapsDir()`.
5. **Status codes.** The document uses `2XX` for success, since the route table does not say which routes answer 201; `default` is the RFC-11 R3 error envelope (`errorEnvelopeSchema`).

## Review Focus

1. **A schema `z.toJSONSchema` cannot represent** (transform, preprocess, date, custom refine) — generation must not throw; `unrepresentable: 'any'` and `io: 'input'`. Pinned in Task 5 (the generator runs over every mounted route).
2. **Non-deterministic output** — object key order or `WeakMap` iteration would change the hash between runs. Paths sorted by key; pinned in Task 5 (two builds, same hash).
3. **Guide missing from the production image** — works in tests, 500 in production. Pinned in Task 6 (E2E runs against the production image).
4. **A cookie session reading the docs** — refused 401. Pinned in Task 6.
5. **A new route added without a catalog entry, or an entry left behind after a route is removed** — pinned in Task 3 (meta-test both directions).

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/rfc/80-integrations/82-external-api.md` | R16–R21, changelog |
| `docs/rfc/30-access/32-authorization-enforcement.md` | R5: the docs routes in the API-key class |
| `docs/specs/2026-09-26-external-api-design.md` | Amendment line |
| `CLAUDE.md` | Rule 10; `GET /api/docs` in the API-keys bullet |
| `apps/api/src/http/validate.ts`, `validate.test.ts` | `validatorSchema()` registry |
| `apps/api/src/http/route-catalog.ts` (new) | `ROUTE_CATALOG` |
| `apps/api/src/http/route-catalog.integration.test.ts` (new) | Meta-test |
| `apps/api/src/http/openapi.ts` (new), `openapi.integration.test.ts` (new) | `buildOpenApi`, `openApiHash` |
| `docs/api/guide.md` (new) | The guide |
| `apps/api/src/http/routes/docs.ts` (new), `docs.integration.test.ts` (new) | Serving routes |
| `apps/api/src/http/api-key-routes.ts` | Two more API-key routes |
| `apps/api/src/app.ts` | Mount `/docs` |
| `apps/api/src/routes-guarded.integration.test.ts` | Route list |
| `apps/api/src/http/openapi-lock.integration.test.ts` (new) | Hash lock |
| `infra/docker/api.Dockerfile` | `COPY docs/api` |
| `apps/e2e/tests/critical-flow.spec.ts` | Docs step |

---

### Task 1: RFC-82 R16–R21, RFC-32 R5, spec amendment, CLAUDE.md rule 10

Docs only; no code.

**Files:**
- Modify: `docs/rfc/80-integrations/82-external-api.md`
- Modify: `docs/rfc/30-access/32-authorization-enforcement.md` (R5)
- Modify: `docs/specs/2026-09-26-external-api-design.md` (Amendments line)
- Modify: `CLAUDE.md`

**Interfaces:** Produces RFC-82 R16–R21 for `@rfc` tags of Tasks 2–6.

- [ ] **Step 1: Append to the Rules of RFC-82, after R15:**

```markdown
- **R16** Every mounted `/api/*` route has one entry in the route catalog (`apps/api/src/http/route-catalog.ts`), keyed `"<METHOD> <path>"`, holding a one-line summary and, where `packages/contracts` defines one, the schema of its JSON response body. Its guard class and permission are read from the route's guard (RFC-32 R5), and its path, query and body schemas from its `validate` middleware (RFC-11 R3), so none of them can differ from what runs. A meta-test fails when a mounted route is missing from the catalog or the catalog names a route that is not mounted.
- **R17** The OpenAPI 3.1 reference is generated from the mounted routes and the catalog with Zod 4's `z.toJSONSchema` (input side); no dependency is added. Paths are sorted by catalog key. Each operation carries its summary, `x-guard` (`public`, `session`, `permission` or `apiKey`), `x-permission` when it has one, its security (`bearerKey` for permission and API-key routes, `sessionCookie` for session and permission routes, none for public ones), its path, query and JSON body schemas, a `2XX` response with the catalogued schema when there is one, and a `default` response with the RFC-11 R3 error body.
- **R18** `docs/api/guide.md` is the hand-written guide: authentication and the key lifecycle (creation, 90-day expiry, every event that revokes a key, and that a script must stop on 401 instead of retrying), what a key cannot reach (R6), the pending workflow (list pending traits, fetch groups by type and trait, map them in a batch), batch semantics (R10–R15), error codes (RFC-12), limits (R9, R10, R14), R and Python examples, and a changelog, newest first.
- **R19** The guide's first line is `openapi-sha256: <hex>`, the SHA-256 of the generated reference serialised with `JSON.stringify`. A test regenerates the reference and fails when the hash differs. The line changes only together with a changelog entry describing the change.
- **R20** `GET /api/docs` answers the guide as `text/markdown; charset=utf-8` and `GET /api/docs/openapi.json` the reference as JSON. Both are API-key routes (RFC-32 R5): without a key, or with a cookie session, they answer 401 `AUTH_UNAUTHENTICATED`.
- **R21** `CLAUDE.md` rule 10: a change that alters how data enters or leaves the platform, or any route's behaviour or shape, checks its effect on the API and updates the route catalog, the guide and its changelog in the same PR.
```

- [ ] **Step 2: Append to the RFC-82 Changelog:**

```markdown
- 2026-09-26 — R16–R21: route catalog, generated OpenAPI reference, guide, hash lock, `/api/docs`, handbook rule (plan 14c).
```

Also update the first changelog entry's "R10–R21 … arrive with plans 14b and 14c" only if it now reads wrong — leave history as written.

- [ ] **Step 3: RFC-32 R5.** In the API-key class sentence, the parenthesised list of API-key routes (or its equivalent) must name `POST /api/batch`, `GET /api/docs` and `GET /api/docs/openapi.json`. Read R5 first and edit the smallest phrase that does it; add a changelog line `- 2026-09-26 — R5: the documentation routes are API-key routes (RFC-82 R20, plan 14c).`

- [ ] **Step 4: Spec amendment.** Append to the `**Amendments:**` line of the spec:

```
2026-09-26 (plan 14c): the catalog holds a summary and an optional response schema only; guard, permission and request schemas are read from the mounted handlers; response schemas are referenced only where `packages/contracts` already has them; the docs routes are API-key routes; the handbook rule is `CLAUDE.md` rule 10.
```

- [ ] **Step 5: CLAUDE.md.** After rule 9 add:

```markdown
10. **Keep the API in step** (RFC-82 R16–R21). A change that alters how data enters or leaves the platform, or any route's behaviour or shape, checks its effect on the external API and updates, in the same PR, the route catalog (`apps/api/src/http/route-catalog.ts`), the guide `docs/api/guide.md` and its changelog. The guide's `openapi-sha256` line changes only together with a changelog entry; `pnpm test` fails until it matches.
```

In the Commands bullet that starts `- API keys (`, after the `POST /api/batch` sentence, add: `` `GET /api/docs` (the guide, Markdown) and `GET /api/docs/openapi.json` (the generated reference) answer a key only `` — keep the bullet ending `: RFC-82.`

- [ ] **Step 6: Verify** `PATH=… pnpm rfc:check` passes. Report files touched.

---

### Task 2: Request-schema registry in `validate()`

**Files:**
- Modify: `apps/api/src/http/validate.ts`
- Test: `apps/api/src/http/validate.test.ts`

**Interfaces:**
- Produces: `export function validatorSchema(fn: unknown): { target: keyof ValidationTargets; schema: z.ZodType } | undefined` — for any middleware returned by `validate(target, schema)` returns that pair; `undefined` for anything else.

- [ ] **Step 1: Failing test** (add to `validate.test.ts`, keep its existing style):

```ts
describe('RFC-82 R16 validatorSchema', () => {
  it('returns the target and schema a validate() middleware was built with', () => {
    const schema = z.strictObject({ id: z.string() });
    expect(validatorSchema(validate('param', schema))).toEqual({ target: 'param', schema });
    expect(validatorSchema(validate('json', schema))).toEqual({ target: 'json', schema });
  });

  it('returns undefined for any other function', () => {
    expect(validatorSchema(() => undefined)).toBeUndefined();
    expect(validatorSchema('x')).toBeUndefined();
  });
});
```

- [ ] **Step 2:** Run `PATH=… pnpm --filter @treerepro/api exec vitest run src/http/validate.test.ts` — FAIL (not exported).

- [ ] **Step 3: Implement** in `validate.ts`: a module `WeakMap<object, { target; schema }>`; `validate()` registers the function it returns (the `inner` middleware for non-json targets, `guarded` for json) before returning it. Export:

```ts
/** The target and schema a `validate` middleware checks; undefined for any other handler. @rfc RFC-82 R16 */
export function validatorSchema(fn: unknown): { target: keyof ValidationTargets; schema: z.ZodType } | undefined {
  return typeof fn === 'function' ? schemas.get(fn) : undefined;
}
```

`validate`'s JSDoc gains `@rfc RFC-82 R16`. Note `import type { z }` must become a value-free type import still (`z.ZodType` is a type) — keep it type-only.

- [ ] **Step 4:** Test passes; `pnpm typecheck` passes. Report files touched.

---

### Task 3: Route catalog and meta-test

**Files:**
- Create: `apps/api/src/http/route-catalog.ts`
- Create: `apps/api/src/http/route-catalog.integration.test.ts`

**Interfaces:**
- Produces:

```ts
import type { z } from 'zod';
/** @rfc RFC-82 R16 */
export interface CatalogEntry {
  /** One line, imperative or noun phrase, ≤ 100 characters, no trailing period. */
  summary: string;
  /** Schema of the full JSON response body as sent (envelope included), when packages/contracts has one. */
  response?: z.ZodType;
}
/** @rfc RFC-82 R16 */
export const ROUTE_CATALOG: Readonly<Record<string, CatalogEntry>>;
```

- [ ] **Step 1: Failing meta-test** `route-catalog.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { ROUTE_CATALOG } from './route-catalog.ts';

function mounted(routes: { method: string; path: string }[]): string[] {
  return [...new Set(routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))].sort();
}

describe('RFC-82 R16 the route catalog lists exactly the mounted routes', () => {
  const t = useTestApp();

  it('every mounted route is catalogued and every catalogued route is mounted', () => {
    const routes = mounted(t.app.routes);
    expect(routes.filter((r) => !(r in ROUTE_CATALOG)), 'missing from the catalog').toEqual([]);
    expect(Object.keys(ROUTE_CATALOG).filter((r) => !routes.includes(r)), 'not mounted').toEqual([]);
  });

  it('every summary is one short line', () => {
    for (const [key, entry] of Object.entries(ROUTE_CATALOG)) {
      expect(entry.summary, key).toMatch(/^[^\n]{3,100}$/);
      expect(entry.summary.endsWith('.'), key).toBe(false);
    }
  });
});
```

- [ ] **Step 2:** Run `PATH=… pnpm --filter @treerepro/api exec vitest run src/http/route-catalog.integration.test.ts` — FAIL (module missing).

- [ ] **Step 3: Write the catalog.** One entry per route in the list of `apps/api/src/routes-guarded.integration.test.ts` ("exposes exactly the routes RFC-22 R1 lists", 115 routes today), in the same order, grouped by comment headers (health, auth, me, help, admin, species, taxa, references, records and curation, traits, imports, export, maps, plots, batch). Read each route's handler to write an accurate summary (what it does for a script, e.g. `'List pending groups of one type and trait'`). For `response`, use a `packages/contracts` schema only when it describes that route's body exactly as sent; if a contract schema describes only `data` or an item, wrap it (`z.object({ data: X })` or `z.object({ data: z.array(X) })`, matching the route's actual `c.json(...)` call); when unsure, omit `response`. Candidates: `healthResponseSchema`, `loginResponseSchema`, `meResponseSchema`, `totpSetupResponseSchema`, `totpConfirmResponseSchema`, `inviteAcceptResponseSchema`, `forgotPasswordResponseSchema`, `createApiKeyResponseSchema`, `batchResponseSchema`, `mapsResponseSchema`, `speciesListItemSchema`, `traitSpeciesItemSchema`, `contestedQueueItemSchema`; grep `packages/contracts/src` for others. The docs routes of Task 6 are **not** added here.

- [ ] **Step 4:** Meta-test passes; `pnpm typecheck` and `pnpm lint` pass. Report files touched.

---

### Task 4: The guide `docs/api/guide.md`

Prose only; Task 6 sets the real hash.

**Files:**
- Create: `docs/api/guide.md`

- [ ] **Step 1:** Write the guide. First line exactly `openapi-sha256: 0000000000000000000000000000000000000000000000000000000000000000`, then a blank line, then `# TreeRepro API guide`. Sections, in order:
  1. **What this is** — the same `/api/*` routes the workspace uses; admins only (RFC-82 R2); JSON in, JSON out; the reference is `GET /api/docs/openapi.json`, this guide is `GET /api/docs`; responses use the RFC-11 envelope `{ data }` / `{ error: { code, message, details? } }`.
  2. **Authentication and the key lifecycle** — create in Settings › API keys (password + TOTP; TOTP must be enabled), shown once; `Authorization: Bearer tr_live_…`; 90-day expiry, renew by creating a new key; never send a cookie too (401); every event that revokes a key (RFC-82 R3 list); **a script must stop on 401, never retry** (a loop with a dead key burns the IP's rate-limit budget).
  3. **What a key cannot do** — self-service and account routes answer 401; `users.invite`, `users.update`, `users.suspend`, `users.delete`, `roles.manage`, `sessions.revoke` answer 403 `PERMISSION_DENIED` (also inside a batch).
  4. **Fixing pending records** — step by step with the real routes: `GET /api/records/pending/traits`, `GET /api/records/pending` (query parameters from `pendingGroupsQuerySchema`), `POST /api/records/pending/map` (body from `mapPendingBodySchema`). Read those schemas in `packages/contracts/src` and the handlers in `apps/api/src/http/routes/dataset/` and show real field names and a real JSON example of each request and response.
  5. **Batch** — `POST /api/batch` body and answer `{ data: { summary: { ok, failed }, results: [{ ref, status, body }] } }`; 1–500 ops; 1 MiB body; order kept, each op commits on its own, a failure does not stop the rest; per-item 400 refusals (path outside `/api/`, nested batch, self-service routes, `GET` with a body); non-JSON answer gives `body: null`; unreadable answer gives 500 `INTERNAL_ERROR`; no ids across operations of one batch — send two batches; re-sending creates no duplicate records (duplicate catalog creates answer the same 409).
  6. **Limits** — 3000 units per 10 minutes per key; a batch of n costs n; a batch that does not fit answers 429 `RATE_LIMITED` and **ran nothing**; honour `Retry-After`.
  7. **Errors** — table of the codes a script meets: `AUTH_UNAUTHENTICATED`, `PERMISSION_DENIED`, `VALIDATION_FAILED` (with `details[].path`), `NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`, plus a pointer to RFC-12 and the domain codes (e.g. `FAMILY_NAME_TAKEN`). Check each against `packages/contracts/src/error-codes.ts`.
  8. **Examples** — R with `httr2` and Python with `requests`: read the key from an environment variable `TREEREPRO_API_KEY`, list pending traits, fetch one trait's groups, send a mapping batch, print failed results, stop on 401 and on 429 (sleep `Retry-After` then resend only if the whole batch was refused). Base URL `https://treerepro.elisabarreto.com.br`.
  9. **Changelog** — newest first; one entry: `- 2026-09-26 — First version: API keys (14a), batch (14b), this guide and the generated reference (14c).`
- [ ] **Step 2:** Every route, field and code named in the guide exists in the code (grep each). Report files touched.

---

### Task 5: OpenAPI generator

**Files:**
- Create: `apps/api/src/http/openapi.ts`
- Test: `apps/api/src/http/openapi.integration.test.ts`

**Interfaces:**
- Consumes: `ROUTE_CATALOG` (Task 3), `validatorSchema` (Task 2), `guardKind`, `guardPermission` (`http/guards.ts`), `errorEnvelopeSchema` (`@treerepro/contracts`), `SESSION_COOKIE` (`http/middleware/session.ts`).
- Produces:

```ts
/** @rfc RFC-82 R17 */
export interface RouteEntry { method: string; path: string; handler: unknown }
/** @rfc RFC-82 R17 */
export function buildOpenApi(routes: readonly RouteEntry[]): Record<string, unknown>;
/** SHA-256 hex of JSON.stringify(doc). @rfc RFC-82 R19 */
export function openApiHash(doc: unknown): string;
```

- [ ] **Step 1: Failing tests** `openapi.integration.test.ts` (uses `useTestApp()` for real `t.app.routes`):

```ts
describe('RFC-82 R17 buildOpenApi', () => {
  const t = useTestApp();
  const doc = () => buildOpenApi(t.app.routes) as any;

  it('is OpenAPI 3.1 with one operation per catalogued route, paths sorted', () => {
    const d = doc();
    expect(d.openapi).toBe('3.1.0');
    const ops = Object.entries(d.paths).flatMap(([p, item]) => Object.keys(item as object).map((m) => `${m.toUpperCase()} ${p}`));
    expect(ops.length).toBe(Object.keys(ROUTE_CATALOG).length);
    expect(Object.keys(d.paths)).toEqual([...Object.keys(d.paths)].sort());
  });

  it('converts :params to {params} and documents them as path parameters', () => {
    const op = doc().paths['/api/species/{id}'].get;
    expect(op.parameters).toContainEqual(expect.objectContaining({ name: 'id', in: 'path', required: true }));
  });

  it('carries guard, permission and security', () => {
    const d = doc();
    expect(d.paths['/api/batch'].post['x-guard']).toBe('apiKey');
    expect(d.paths['/api/batch'].post.security).toEqual([{ bearerKey: [] }]);
    expect(d.paths['/api/health'].get['x-guard']).toBe('public');
    expect(d.paths['/api/health'].get.security).toEqual([]);
    const map = d.paths['/api/records/pending/map'].post;
    expect(map['x-guard']).toBe('permission');
    expect(map['x-permission']).toBe('records.review');
    expect(map.security).toEqual([{ sessionCookie: [] }, { bearerKey: [] }]);
    expect(d.paths['/api/auth/me'].get.security).toEqual([{ sessionCookie: [] }]);
  });

  it('documents the JSON body, query parameters, responses and the error body', () => {
    const d = doc();
    expect(d.paths['/api/records/pending/map'].post.requestBody.content['application/json'].schema.type).toBe('object');
    expect(d.paths['/api/records/pending'].get.parameters.some((p: any) => p.in === 'query')).toBe(true);
    expect(d.paths['/api/batch'].post.responses['2XX'].content['application/json'].schema).toBeDefined();
    expect(d.paths['/api/batch'].post.responses.default.content['application/json'].schema).toBeDefined();
  });

  it('is deterministic', () => {
    expect(openApiHash(buildOpenApi(t.app.routes))).toBe(openApiHash(buildOpenApi(t.app.routes)));
    expect(openApiHash(doc())).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

Adjust the `x-permission` expectation to the permission `POST /api/records/pending/map` actually requires (read `apps/api/src/http/routes/dataset/`).

- [ ] **Step 2:** Run it — FAIL (module missing).

- [ ] **Step 3: Implement** `openapi.ts`:
  - Group `routes` (skip `ALL`) by `"<METHOD> <path>"`; iterate `Object.keys(ROUTE_CATALOG).sort()`; a catalogued key with no mounted route throws (the meta-test prevents it).
  - Guard: first handler with `guardKind` → kind; none → `public`. Permission: `guardPermission`.
  - Security: `public` → `[]`; `session` → `[{ sessionCookie: [] }]`; `permission` → `[{ sessionCookie: [] }, { bearerKey: [] }]`; `apiKey` → `[{ bearerKey: [] }]`.
  - JSON Schema: `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })`, then delete its `$schema` key.
  - `param` / `query` schemas: one parameter per `properties` entry: `{ name, in: 'path' | 'query', required: in === 'path' || required.includes(name), schema }`.
  - `json` schema: `requestBody: { required: true, content: { 'application/json': { schema } } }`.
  - `responses`: `'2XX': { description: 'Success', content?: { 'application/json': { schema } } }` (content only with a catalogued `response`), `default: { description: 'Error (RFC-11 R3, RFC-12)', content: { 'application/json': { schema: <errorEnvelopeSchema> } } }`.
  - Path: `path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')`.
  - Document: `{ openapi: '3.1.0', info: { title: 'TreeRepro API', version: '1', description: 'Guide: GET /api/docs' }, components: { securitySchemes: { bearerKey: { type: 'http', scheme: 'bearer', description: 'tr_live_… API key (RFC-82)' }, sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } } }, paths }`.
  - `openApiHash`: `createHash('sha256').update(JSON.stringify(doc)).digest('hex')` (`node:crypto`).

- [ ] **Step 4:** Tests pass; typecheck, lint, rfc:check pass. Report files touched.

---

### Task 6: `/api/docs` routes, hash lock, production image, E2E

**Files:**
- Create: `apps/api/src/http/routes/docs.ts`, `apps/api/src/http/routes/docs.integration.test.ts`
- Create: `apps/api/src/http/openapi-lock.integration.test.ts`
- Modify: `apps/api/src/http/api-key-routes.ts`, `apps/api/src/app.ts`, `apps/api/src/http/route-catalog.ts`, `apps/api/src/routes-guarded.integration.test.ts`, `infra/docker/api.Dockerfile`, `docs/api/guide.md` (hash line), `apps/e2e/tests/critical-flow.spec.ts`

**Interfaces:**
- Consumes: `buildOpenApi`, `openApiHash`, `RouteEntry` (Task 5); `requireApiKey` (`http/middleware/session.ts`); `createAdminKey` or the equivalent helper in `apps/api/test/helpers/` used by `batch.integration.test.ts`.
- Produces: `docsRoutes(routes: () => readonly RouteEntry[], guidePath: string)`; `defaultGuidePath(): string`; `AppDeps.guidePath?: string`.

- [ ] **Step 1: Failing tests** `docs.integration.test.ts` — follow `batch.integration.test.ts` for how it creates an admin key and calls with `Authorization: Bearer`:
  - `GET /api/docs` with a key → 200, `content-type` starts `text/markdown`, body's first line matches `/^openapi-sha256: [0-9a-f]{64}$/`.
  - `GET /api/docs/openapi.json` with a key → 200, `openapi === '3.1.0'`, `paths['/api/docs']` present.
  - Both without credentials → 401 `AUTH_UNAUTHENTICATED`; both with a cookie session only (`loginAs`) → 401.

  `openapi-lock.integration.test.ts`:

```ts
describe('RFC-82 R19 the guide pins the generated reference', () => {
  const t = useTestApp();
  it('the openapi-sha256 line matches the generated reference', async () => {
    const guide = await readFile(defaultGuidePath(), 'utf8');
    const pinned = /^openapi-sha256: ([0-9a-f]{64})\n/.exec(guide)?.[1];
    const actual = openApiHash(buildOpenApi(t.app.routes));
    expect(pinned, `API surface changed: add a changelog entry to docs/api/guide.md and set its first line to "openapi-sha256: ${actual}" (CLAUDE.md rule 10)`).toBe(actual);
  });
});
```

  Update `routes-guarded.integration.test.ts`'s list with `'GET /api/docs'` and `'GET /api/docs/openapi.json'`.
- [ ] **Step 2:** Run them — FAIL.
- [ ] **Step 3: Implement.**
  - `docs.ts`: `defaultGuidePath()` returns `fileURLToPath(new URL('../../../../../docs/api/guide.md', import.meta.url))` — verify it resolves to `<repo>/docs/api/guide.md` from both `apps/api/src/http/routes/` and `apps/api/dist/http/routes/`. Routes, each with `requireApiKey`: `GET /` reads the file (cache after first read) and answers `c.body(text, 200, { 'content-type': 'text/markdown; charset=utf-8' })`; `GET /openapi.json` answers `c.json(buildOpenApi(routes()))`, memoised after first build. `@rfc RFC-82 R20` on exports.
  - `app.ts`: `AppDeps.guidePath?: string`; `app.route('/docs', docsRoutes(() => root.routes as RouteEntry[], deps.guidePath ?? defaultGuidePath()))`; add `@rfc RFC-82 R20` to `createApp`.
  - `API_KEY_ROUTES`: add `'GET /api/docs'`, `'GET /api/docs/openapi.json'`; `@rfc RFC-82 R20`.
  - `ROUTE_CATALOG`: add both routes (summaries `'Read this guide as Markdown'`, `'Read the generated OpenAPI 3.1 reference'`).
  - `api.Dockerfile` runtime stage: `COPY docs/api ./docs/api` (WORKDIR is `/workspace` there; the file must land at `/workspace/docs/api/guide.md`, which `defaultGuidePath()` resolves from `/workspace/apps/api/dist/http/routes/`). Check `.dockerignore` does not exclude `docs/`; if it does, add an exception `!docs/api`. Check the dev stack (`compose.yml` / `infra/docker/dev.Dockerfile`) sees the file too (bind mount of the repo or equivalent); if not, mount it read-only.
  - Run the lock test, copy the hash it prints into the guide's first line.
- [ ] **Step 4: E2E.** In `critical-flow.spec.ts`, in the `RFC-82 R10-R15` test (which has `apiSecret`), after the batch, before `anonymous.dispose()`, add:

```ts
    // RFC-82 R20: the guide and the reference ship in the production image.
    const guide = await anonymous.get(`${BASE_URL}/api/docs`, {
      headers: { authorization: `Bearer ${apiSecret}` },
    });
    expect(guide.status()).toBe(200);
    expect(await guide.text()).toMatch(/^openapi-sha256: [0-9a-f]{64}\n/);
    const reference = await anonymous.get(`${BASE_URL}/api/docs/openapi.json`, {
      headers: { authorization: `Bearer ${apiSecret}` },
    });
    expect((await reference.json()).paths['/api/batch']).toBeDefined();
```

  and rename the test title to `'RFC-82 R10-R15, R20 sends a batch with the key, reads the docs and sees its effect in the workspace'`.
- [ ] **Step 5:** `pnpm --filter @treerepro/api test` for the touched files, `pnpm typecheck`, `pnpm lint`, `pnpm rfc:check`, `pnpm build` pass; `docker build -f infra/docker/api.Dockerfile .` succeeds and `docker run --rm --entrypoint ls <image> /workspace/docs/api` lists `guide.md`. Run `pnpm test:e2e` once. Report files touched.
