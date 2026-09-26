# External API 14a — API keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin creates a personal API key in Settings and calls every permission-guarded `/api/*` route from a script with `Authorization: Bearer tr_live_…`, with the same validation, permissions and authorship as the workspace.

**Architecture:** A new `api_keys` table stores the SHA-256 of each key. `resolveSession` accepts a Bearer key as a second credential and sets the same `user` a cookie session sets, so `requirePermission` and every route work unchanged. `requireSession` now demands a cookie session, so every self-service (account) route refuses a key. The origin check skips Bearer-only requests, the global limiter gets a per-key bucket, and an `AsyncLocalStorage` store lets `recordAudit` tag entries written with a key.

**Tech Stack:** Hono 4, Drizzle + PostgreSQL 18, Redis (rate limit), Zod 4, Vitest 5 + testcontainers, React 19 + TanStack Query, Playwright.

**Spec:** `docs/specs/2026-09-26-external-api-design.md` (§2, R-1–R-9).

## Global Constraints

- Node 24.21.0 and pnpm 12.4.1 from asdf: prefix every command with `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH`.
- Work only in the worktree `.worktrees/external-api` (branch `feat/external-api`). Never `checkout -b` in the main checkout.
- RFC → failing test → code (RFC-00, RFC-01). Every exported symbol in `apps/*/src` and `packages/*/src` carries `@rfc RFC-NN Rx`.
- No database mocks. Integration tests use `useTestApp()` from `apps/api/test/helpers/app.ts`.
- English everywhere: code, comments, docs, UI, commits.
- Key format: `tr_live_` + 32 random bytes in base64url (43 characters). Only its SHA-256 hex is stored. Lifetime is 90 days.
- Key rate limit: 3000 operations per 10 minutes per key.
- Only a user holding the `admin` **system** role (`roles.is_system = true AND roles.name = 'admin'`) can create or use a key.
- Migration number: list `apps/api/drizzle/` on `origin/main` before generating. At the time of writing, 0041 is the last one, so this plan uses `0042_api_keys.sql`; renumber if `origin/main` moved.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A Bearer header on a public route** (for example `POST /api/auth/login` with a bogus key) must answer 401, not fall through to the unauthenticated path without the origin check. Pinned in Task 4.
2. **A key whose owner loses the admin role mid-life** must stop working on the next request, without waiting for any cache. Pinned in Task 3 (`findUsableKey` reads the roles every time).
3. **The TOTP code at key creation** must be single-use (`claimTotpCounter`) and rate-limited per user, or a stolen session could brute-force it. Single use is pinned in Task 3, the rate limit in Task 5.
4. **Revoking someone else's key id** must answer 404 and change nothing. Pinned in Task 3.
5. **The one-time secret** must not linger in the React Query cache after the dialog closes (`gcTime: 0` plus `reset()`, as `PasswordSection` does). Pinned in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/rfc/80-integrations/82-external-api.md` (new) | RFC-82 R1–R9 |
| `docs/rfc/README.md`, `docs/rfc/20-auth/22-login-and-sessions.md`, `docs/rfc/20-auth/24-rate-limiting.md`, `docs/rfc/10-platform/02-security-principles.md`, `docs/rfc/40-data-protection/41-audit-log.md`, `docs/rfc/30-access/32-authorization-enforcement.md` | Cross-reference amendments |
| `apps/api/src/db/schema/api-keys.ts` (new) | Drizzle table |
| `apps/api/drizzle/0042_api_keys.sql` (generated, then edited) | Table and grants |
| `packages/contracts/src/api-keys.ts` (new) | Zod schemas shared by API and web |
| `packages/contracts/src/audit.ts` | Two new audit actions |
| `apps/api/src/auth/api-keys.ts` (new) | Generate, create, list, revoke, resolve |
| `apps/api/src/audit/via.ts` (new) | `AsyncLocalStorage` marking a key-authenticated request |
| `apps/api/src/audit/audit.ts` | Merges `via` into the metadata |
| `apps/api/src/http/env.ts` | `apiKey` context variable |
| `apps/api/src/http/middleware/session.ts` | Bearer resolution; `requireSession` needs a cookie session |
| `apps/api/src/http/origin-check.ts` | Bearer-only exemption |
| `apps/api/src/http/middleware/rate-limit.ts`, `apps/api/src/auth/rate-limit.ts` | Per-key bucket |
| `apps/api/src/http/routes/me.ts` | `GET/POST /api/me/api-keys`, `DELETE /api/me/api-keys/:id` |
| `apps/api/src/http/self-service-routes.ts`, `apps/api/src/routes-guarded.integration.test.ts` | Route lists |
| `apps/web/src/api/me.ts`, `apps/web/src/components/settings/ApiKeysSection.tsx` (new), `apps/web/src/pages/SettingsPage.tsx` | Settings › API keys |
| `apps/e2e/tests/critical-flow.spec.ts` | End-to-end step |
| `CLAUDE.md` | One line under Commands |

---

### Task 1: RFC-82 and cross-references

**Files:**
- Create: `docs/rfc/80-integrations/82-external-api.md`
- Modify: `docs/rfc/README.md` (index table), `docs/rfc/20-auth/22-login-and-sessions.md` (R7, R8, changelog), `docs/rfc/20-auth/24-rate-limiting.md` (R3 table, R4, changelog), `docs/rfc/10-platform/02-security-principles.md` (R3 note, changelog), `docs/rfc/40-data-protection/41-audit-log.md` (action table, changelog), `docs/rfc/30-access/32-authorization-enforcement.md` (R5 note, changelog)

**Interfaces:**
- Produces: rule ids `RFC-82 R1`–`R9`, which every later task cites in `@rfc` tags.

- [ ] **Step 1: Write RFC-82**

```markdown
# RFC-82 — External API

| Field | Value |
|---|---|
| Status | draft |
| Category | integrations |
| Supersedes | — |

## Context

Admins fix the imported dataset from their own machines with R or Python scripts: they pull what is pending, correct it locally, and send the corrections back. The external API is not a second surface. It is the same `/api/*` routes the workspace calls, reached with a personal key instead of a session cookie, so every validation, permission check and authorship rule applies unchanged (design: `docs/specs/2026-09-26-external-api-design.md`).

## Rules

- **R1** An API key is `tr_live_` followed by 32 random bytes in base64url. It is shown once, when created; only its SHA-256 (hex) is stored, in `api_keys`, with the owner, a name (1–60 characters), the first 8 characters after `tr_live_` for display, the creation time, `expires_at` = creation + 90 days, `last_used_at` and `revoked_at`. Rows are never deleted.
- **R2** Only a user holding the `admin` system role can create or use a key. Creating one needs a session (R6), the current password and a current TOTP code, which is consumed like any other TOTP code (RFC-23 R3). A user without TOTP enabled gets 409 `AUTH_TOTP_NOT_ENABLED`; a user without the admin role gets 403 `PERMISSION_DENIED`. `POST /api/me/api-keys` is limited per user by the `apiKeyCreate` bucket (RFC-24 R3).
- **R3** Every request resolves `Authorization: Bearer <key>` before routing. The key authenticates when its hash exists, it is not revoked, it has not expired, its user is `active` and holds the `admin` system role (read on every request, not cached). The request then carries that `user`, and no session. A Bearer header that does not authenticate answers 401 `AUTH_UNAUTHENTICATED` on every route, public ones included, and the response does not say why. `last_used_at` is written at most once a minute per key.
- **R4** A request carrying both a session cookie and a Bearer header answers 401 `AUTH_UNAUTHENTICATED`.
- **R5** A request with a Bearer header and no `Cookie` header is exempt from the origin check (RFC-02 R3): a browser never attaches a Bearer header by itself, so there is no cross-site request to forge.
- **R6** A key reaches permission-guarded routes only. Every self-service route (RFC-32 R5), including key management, the profile, the password, TOTP, sessions, `GET /api/auth/me` and the help pages, needs a cookie session, so a key answers 401 there and cannot create another key.
- **R7** `GET /api/me/api-keys` answers `{ eligible, keys }`: `eligible` is whether the user holds the admin system role; `keys` lists their keys, newest first, as `{ id, name, prefix, createdAt, expiresAt, lastUsedAt, revokedAt, state }` with `state` one of `active`, `expired`, `revoked`. `POST /api/me/api-keys` answers `{ key, secret }`. `DELETE /api/me/api-keys/:id` revokes one of the user's own active keys; any other id answers 404 `NOT_FOUND`.
- **R8** Creating and revoking a key write `auth.api_key.created` and `auth.api_key.revoked` (RFC-41), target `api_key`. Every audit entry written during a key-authenticated request carries `via: "api_key"` and `apiKeyId` in its metadata. Record and annotation writes stay provenance-only (RFC-65 R12): their `created_by` is the key's owner.
- **R9** Key-authenticated requests use the `global:api_key` bucket of RFC-24 R4, 3000 per 10 minutes per key, instead of the per-session bucket.

## Open questions

None.

## Changelog

- 2026-09-26 — Created with R1–R9 (plan 14a). R10–R21 (batch, documentation) arrive with plans 14b and 14c.
```

- [ ] **Step 2: Add the index row and the cross-references**

- In `docs/rfc/README.md`, add `| RFC-82 | External API | draft |` after the RFC-81 row.
- In RFC-22, append to **R7**: "A Bearer API key is resolved first (RFC-82 R3, R4)." Change **R8** to: "`requireSession` answers 401 `AUTH_UNAUTHENTICATED` when no cookie session was resolved; a request authenticated by an API key has no session (RFC-82 R6)."
- In RFC-24, add the rows `apiKeyCreate` (5 per 15 minutes per user; RFC-82 R2) and `apiKey` (3000 per 10 minutes per key; RFC-82 R9) to the **R3** table. Append to **R4**: "A key-authenticated request uses the per-key bucket (RFC-82 R9)."
- In RFC-02, append to **R3**: "Bearer-only requests are exempt (RFC-82 R5)."
- In RFC-41, add these rows to the action table, after `auth.totp.recovery_used`:
  - `| \`auth.api_key.created\` | API key created by its owner (RFC-82 R8). |`
  - `| \`auth.api_key.revoked\` | API key revoked by its owner (RFC-82 R8). |`
- In RFC-32, append to **R5**: "Self-service routes need a cookie session; an API key never reaches them (RFC-82 R6)."
- Add a dated changelog line `2026-09-26 — … (RFC-82, plan 14a).` to each amended RFC.

- [ ] **Step 3: Run the RFC checks**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm rfc:check`
Expected: PASS. The audit table and contracts check fails until Task 2 adds the actions; if `rfc:check` covers it, do Task 2 Step 1 before committing.

- [ ] **Step 4: Commit**

```bash
git add docs/rfc
git commit -m "docs(rfc): RFC-82 external API keys (R1-R9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Table, migration, contracts and audit actions

**Files:**
- Create: `apps/api/src/db/schema/api-keys.ts`, `packages/contracts/src/api-keys.ts`, `packages/contracts/src/api-keys.test.ts`
- Modify: `apps/api/src/db/schema/index.ts` (export), `packages/contracts/src/index.ts` (export), `packages/contracts/src/audit.ts` (two actions after `'auth.totp.recovery_used'`)
- Generate, then edit: `apps/api/drizzle/0042_api_keys.sql`
- Test: `apps/api/src/db/schema/api-keys.integration.test.ts`

**Interfaces:**
- Produces:
  - `apiKeys` (Drizzle table) and `ApiKeyRow`
  - `apiKeySummarySchema`, `ApiKeySummary`
  - `apiKeyListSchema` (`{ eligible: boolean, keys: ApiKeySummary[] }`), `ApiKeyList`
  - `createApiKeyBodySchema` (`{ name, password, code }`), `CreateApiKeyBody`
  - `createApiKeyResponseSchema` (`{ key: ApiKeySummary, secret: string }`), `CreateApiKeyResponse`
  - audit actions `'auth.api_key.created'` and `'auth.api_key.revoked'`

- [ ] **Step 1: Add the audit actions**

In `packages/contracts/src/audit.ts`, directly after `'auth.totp.recovery_used',`:

```ts
  'auth.api_key.created',
  'auth.api_key.revoked',
```

- [ ] **Step 2: Write the failing contracts test**

`packages/contracts/src/api-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { apiKeyListSchema, createApiKeyBodySchema } from './api-keys.ts';

describe('RFC-82 R2, R7 API key contracts', () => {
  it('R2 requires a 1-60 character name, a password and a 6-digit code', () => {
    expect(createApiKeyBodySchema.safeParse({ name: 'laptop', password: 'x', code: '123456' }).success).toBe(true);
    expect(createApiKeyBodySchema.safeParse({ name: '', password: 'x', code: '123456' }).success).toBe(false);
    expect(createApiKeyBodySchema.safeParse({ name: 'a'.repeat(61), password: 'x', code: '123456' }).success).toBe(false);
    expect(createApiKeyBodySchema.safeParse({ name: 'laptop', password: 'x', code: '12345' }).success).toBe(false);
    expect(createApiKeyBodySchema.safeParse({ name: 'laptop', password: 'x', code: '123456', extra: 1 }).success).toBe(false);
  });

  it('R7 lists keys with a state', () => {
    const parsed = apiKeyListSchema.parse({
      eligible: true,
      keys: [
        {
          id: '0199a1b2-0000-7000-8000-000000000001',
          name: 'laptop',
          prefix: 'AbCdEfGh',
          createdAt: '2026-09-26T10:00:00.000Z',
          expiresAt: '2026-12-25T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
          state: 'active',
        },
      ],
    });
    expect(parsed.keys[0]?.state).toBe('active');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts packages/contracts/src/api-keys.test.ts`
Expected: FAIL, because `./api-keys.ts` does not exist.

- [ ] **Step 4: Write the contracts**

`packages/contracts/src/api-keys.ts` (reuse `totpCodeSchema` from `./auth.ts`, which `totpDisableBodySchema` already uses):

```ts
import { z } from 'zod';
import { totpCodeSchema } from './auth.ts';

/** @rfc RFC-82 R7 */
export const API_KEY_STATES = ['active', 'expired', 'revoked'] as const;

/** @rfc RFC-82 R7 */
export const apiKeySummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  state: z.enum(API_KEY_STATES),
});

/** @rfc RFC-82 R7 */
export const apiKeyListSchema = z.strictObject({
  eligible: z.boolean(),
  keys: z.array(apiKeySummarySchema),
});

/** @rfc RFC-82 R1, R2 */
export const createApiKeyBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(128),
  code: totpCodeSchema,
});

/** @rfc RFC-82 R1, R7 */
export const createApiKeyResponseSchema = z.strictObject({
  key: apiKeySummarySchema,
  secret: z.string(),
});

export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;
export type ApiKeyList = z.infer<typeof apiKeyListSchema>;
export type CreateApiKeyBody = z.infer<typeof createApiKeyBodySchema>;
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
```

If `totpCodeSchema` is not exported from `auth.ts`, export it there with `/** @rfc RFC-23 R3 */`. Add `export * from './api-keys.ts';` to `packages/contracts/src/index.ts`.

- [ ] **Step 5: Run the contracts tests**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts packages/contracts`
Expected: PASS. The audit test that parses the RFC-41 table passes because Task 1 added the rows.

- [ ] **Step 6: Write the Drizzle table**

`apps/api/src/db/schema/api-keys.ts`:

```ts
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Personal API keys. Only the SHA-256 of a key is stored; rows are never
 * deleted (revocation sets `revoked_at`), so the runtime role holds no DELETE.
 * @rfc RFC-82 R1
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
    index('api_keys_user_idx').on(t.userId, t.createdAt),
  ],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
```

Export it from `apps/api/src/db/schema/index.ts` the same way the other tables are exported.

- [ ] **Step 7: Generate and edit the migration**

Run: `cd apps/api && PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm db:generate --name api_keys`
Expected: a new `drizzle/0042_api_keys.sql` holding `CREATE TABLE "api_keys"` and the two indexes.

Append the grant block, the 0029 pattern:

```sql
--> statement-breakpoint
-- RFC-82 R1: keys are revoked, never deleted. Stated explicitly rather than
-- left to the migrator's default privileges (infra/postgres/init/01-roles.sh,
-- which also grants DELETE). Guarded like 0029: the role is absent in a bare
-- drizzle-kit check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE DELETE, TRUNCATE ON api_keys FROM treerepro_app;
    GRANT SELECT, INSERT, UPDATE ON api_keys TO treerepro_app;
  END IF;
END;
$$;
```

- [ ] **Step 8: Write the schema integration test**

`apps/api/src/db/schema/api-keys.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../../test/helpers/app.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { apiKeys } from './api-keys.ts';

describe('RFC-82 R1 api_keys table', () => {
  const t = useTestApp();

  it('stores one row per hash and rejects a repeated hash', async () => {
    const { user } = await createUser(t.db);
    const row = {
      userId: user.id,
      name: 'laptop',
      keyHash: 'f'.repeat(64),
      keyPrefix: 'AbCdEfGh',
      expiresAt: new Date(Date.now() + 1000),
    };
    await t.db.insert(apiKeys).values(row);
    await expect(t.db.insert(apiKeys).values(row)).rejects.toThrow();
  });
});
```

- [ ] **Step 9: Run it**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts apps/api/src/db/schema/api-keys.integration.test.ts`
Expected: PASS (testcontainers applies every migration, including 0042).

- [ ] **Step 10: Commit**

```bash
git add packages/contracts apps/api/src/db/schema apps/api/drizzle
git commit -m "feat(api): api_keys table and contracts (RFC-82 R1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The key service

**Files:**
- Create: `apps/api/src/auth/api-keys.ts`
- Test: `apps/api/src/auth/api-keys.integration.test.ts`

**Interfaces:**
- Consumes:
  - `apiKeys`, `ApiKeyRow` (Task 2)
  - `hashToken(raw: string): string` from `apps/api/src/auth/tokens.ts`
  - `verifyPassword` from `./password.ts`
  - `verifyTotpCode(secret, code, nowMs)` from `./totp.ts`
  - `ctx.mfa.claimTotpCounter(userId, counter)`
  - `recordAudit` from `../audit/audit.ts`
- Produces:
  - `API_KEY_PREFIX = 'tr_live_'`
  - `API_KEY_TTL_MS`
  - `generateApiKey(): string`
  - `bearerToken(header: string | undefined): string | null`
  - `holdsAdminRole(db: DbExecutor, userId: string): Promise<boolean>`
  - `findUsableKey(deps: { db: Db; now: () => number }, raw: string): Promise<{ id: string; user: UserRow } | null>`
  - `createApiKey(ctx: AuthContext, input: { user: UserRow; name: string; password: string; code: string } & RequestMeta): Promise<CreateApiKeyResponse>`
  - `listApiKeys(ctx: AuthContext, user: UserRow): Promise<ApiKeyList>`
  - `revokeApiKey(ctx: AuthContext, input: { user: UserRow; id: string } & RequestMeta): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/auth/api-keys.integration.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ctxOf, useTestApp } from '../../test/helpers/app.ts';
import { lastAudit } from '../../test/helpers/audit.ts';
import { adminRoleId, systemRoleId } from '../../test/helpers/roles.ts';
import { createUser, DEFAULT_PASSWORD } from '../../test/helpers/users.ts';
import { apiKeys } from '../db/schema/api-keys.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { users } from '../db/schema/users.ts';
import {
  bearerToken,
  createApiKey,
  findUsableKey,
  generateApiKey,
  listApiKeys,
  revokeApiKey,
} from './api-keys.ts';
import { generateTotpCode, generateTotpSecret } from './totp.ts';

const META = { ip: '10.0.0.1', userAgent: 'test-agent' };

describe('RFC-82 R1-R3, R7, R8 API key service', () => {
  const t = useTestApp();

  async function admin() {
    const secret = generateTotpSecret();
    const { user } = await createUser(t.db, { totpSecret: secret, roles: [await adminRoleId(t.db)] });
    return { user, secret };
  }
  const code = (secret: string, offset = 0) => generateTotpCode(secret, t.clock.now + offset * 30_000);

  it('R1 generates tr_live_ keys of 43 base64url characters and reads a Bearer header', () => {
    expect(generateApiKey()).toMatch(/^tr_live_[A-Za-z0-9_-]{43}$/);
    expect(bearerToken('Bearer tr_live_abc')).toBe('tr_live_abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it('R2 creates a key for an admin with password and TOTP, stores only the hash, audits it', async () => {
    const { user, secret } = await admin();
    const out = await createApiKey(ctxOf(t), { user, name: 'laptop', password: DEFAULT_PASSWORD, code: code(secret), ...META });
    expect(out.secret).toMatch(/^tr_live_/);
    expect(out.key).toMatchObject({ name: 'laptop', state: 'active', prefix: out.secret.slice(8, 16) });
    const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, out.key.id));
    expect(row?.keyHash).not.toContain(out.secret);
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(await lastAudit(t.db, user.id)).toMatchObject({ action: 'auth.api_key.created', targetType: 'api_key', targetId: out.key.id });
  });

  it('R2 refuses a non-admin, a user without TOTP, a wrong password and a reused code', async () => {
    const contributor = await createUser(t.db, { totpSecret: generateTotpSecret(), roles: [await systemRoleId(t.db, 'contributor')] });
    await expect(createApiKey(ctxOf(t), { user: contributor.user, name: 'x', password: DEFAULT_PASSWORD, code: code(contributor.user.totpSecret!), ...META })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const noTotp = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    await expect(createApiKey(ctxOf(t), { user: noTotp.user, name: 'x', password: DEFAULT_PASSWORD, code: '000000', ...META })).rejects.toMatchObject({ code: 'AUTH_TOTP_NOT_ENABLED' });

    const { user, secret } = await admin();
    await expect(createApiKey(ctxOf(t), { user, name: 'x', password: 'wrong', code: code(secret), ...META })).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    await createApiKey(ctxOf(t), { user, name: 'x', password: DEFAULT_PASSWORD, code: code(secret, 1), ...META });
    await expect(createApiKey(ctxOf(t), { user, name: 'y', password: DEFAULT_PASSWORD, code: code(secret, 1), ...META })).rejects.toMatchObject({ code: 'AUTH_TOTP_INVALID' });
  });

  it('R3 resolves a usable key and refuses revoked, expired, suspended and demoted owners', async () => {
    const { user, secret } = await admin();
    const deps = { db: t.db, now: () => t.clock.now };
    const make = async (offset: number) =>
      (await createApiKey(ctxOf(t), { user, name: 'k', password: DEFAULT_PASSWORD, code: code(secret, offset), ...META })).secret;

    const ok = await make(2);
    expect((await findUsableKey(deps, ok))?.user.id).toBe(user.id);
    expect(await findUsableKey(deps, 'tr_live_unknown')).toBeNull();

    const expired = await make(3);
    await t.db.update(apiKeys).set({ expiresAt: new Date(t.clock.now - 1) }).where(eq(apiKeys.keyPrefix, expired.slice(8, 16)));
    expect(await findUsableKey(deps, expired)).toBeNull();

    await t.db.delete(userRoles).where(eq(userRoles.userId, user.id));
    expect(await findUsableKey(deps, ok)).toBeNull();
    await t.db.insert(userRoles).values({ userId: user.id, roleId: await adminRoleId(t.db) });

    await t.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));
    expect(await findUsableKey(deps, ok)).toBeNull();
  });

  it('R7, R8 lists own keys newest first and revokes only own active keys', async () => {
    const a = await admin();
    const b = await admin();
    const first = await createApiKey(ctxOf(t), { user: a.user, name: 'one', password: DEFAULT_PASSWORD, code: code(a.secret, 4), ...META });
    const second = await createApiKey(ctxOf(t), { user: a.user, name: 'two', password: DEFAULT_PASSWORD, code: code(a.secret, 5), ...META });

    await expect(revokeApiKey(ctxOf(t), { user: b.user, id: first.key.id, ...META })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await revokeApiKey(ctxOf(t), { user: a.user, id: first.key.id, ...META });
    await expect(revokeApiKey(ctxOf(t), { user: a.user, id: first.key.id, ...META })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await lastAudit(t.db, a.user.id)).toMatchObject({ action: 'auth.api_key.revoked', targetId: first.key.id });

    const list = await listApiKeys(ctxOf(t), a.user);
    expect(list.eligible).toBe(true);
    expect(list.keys.map((k) => [k.name, k.state])).toEqual([['two', 'active'], ['one', 'revoked']]);
    expect(second.key.id).toBe(list.keys[0]?.id);
  });
});
```

Before running, check `apps/api/src/auth/totp.ts` for the real names of the secret and code generators, and `apps/api/test/helpers/audit.ts` for the helper that reads a user's latest audit row (the plan calls it `lastAudit`). Use the real names in the test; do not add new helpers when these exist.

- [ ] **Step 2: Run to verify failure**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts apps/api/src/auth/api-keys.integration.test.ts`
Expected: FAIL, because `./api-keys.ts` does not exist.

- [ ] **Step 3: Implement**

`apps/api/src/auth/api-keys.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { ApiKeyList, ApiKeySummary, CreateApiKeyResponse } from '@treerepro/contracts';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.ts';
import type { Db, DbExecutor } from '../db/client.ts';
import { type ApiKeyRow, apiKeys } from '../db/schema/api-keys.ts';
import { ADMIN_ROLE_NAME, roles } from '../db/schema/roles.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { type UserRow, users } from '../db/schema/users.ts';
import { AppError } from '../http/errors.ts';
import type { AuthContext, RequestMeta } from './context.ts';
import { verifyPassword } from './password.ts';
import { hashToken } from './tokens.ts';
import { verifyTotpCode } from './totp.ts';

/** @rfc RFC-82 R1 */
export const API_KEY_PREFIX = 'tr_live_';
/** @rfc RFC-82 R1 */
export const API_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60_000;

/** @rfc RFC-82 R1 */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/** The token of an `Authorization: Bearer …` header, or null. @rfc RFC-82 R3 */
export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer (\S+)$/);
  return match?.[1] ?? null;
}

/** Holds the `admin` system role (RFC-31 R10). @rfc RFC-82 R2, R3 */
export async function holdsAdminRole(db: DbExecutor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: roles.id })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(roles.name, ADMIN_ROLE_NAME), eq(roles.isSystem, true)))
    .limit(1);
  return row !== undefined;
}

/** @rfc RFC-82 R3 */
export async function findUsableKey(
  deps: { db: Db; now: () => number },
  raw: string,
): Promise<{ id: string; user: UserRow } | null> {
  const now = new Date(deps.now());
  const [row] = await deps.db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(
      and(
        eq(apiKeys.keyHash, hashToken(raw)),
        isNull(apiKeys.revokedAt),
        gt(apiKeys.expiresAt, now),
        eq(users.status, 'active'),
      ),
    );
  if (!row || !(await holdsAdminRole(deps.db, row.user.id))) return null;
  await deps.db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, row.key.id),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(now.getTime() - TOUCH_EVERY_MS))),
      ),
    );
  return { id: row.key.id, user: row.user };
}

function summary(row: ApiKeyRow, now: number): ApiKeySummary {
  const state = row.revokedAt ? 'revoked' : row.expiresAt.getTime() <= now ? 'expired' : 'active';
  return {
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    state,
  };
}

/** @rfc RFC-82 R1, R2, R8 */
export async function createApiKey(
  ctx: AuthContext,
  input: { user: UserRow; name: string; password: string; code: string } & RequestMeta,
): Promise<CreateApiKeyResponse> {
  const { user } = input;
  if (!(await holdsAdminRole(ctx.db, user.id))) {
    throw new AppError('PERMISSION_DENIED', 'Only administrators can create API keys');
  }
  if (user.totpEnabledAt === null || user.totpSecret === null) {
    throw new AppError('AUTH_TOTP_NOT_ENABLED', 'Enable two-factor authentication first');
  }
  const verified = user.passwordHash !== null && (await verifyPassword(user.passwordHash, input.password));
  if (!verified) throw new AppError('AUTH_INVALID_CREDENTIALS', 'Password is incorrect');
  const counter = verifyTotpCode(user.totpSecret, input.code, ctx.now());
  if (counter === null || !(await ctx.mfa.claimTotpCounter(user.id, counter))) {
    throw new AppError('AUTH_TOTP_INVALID', 'Code is not valid');
  }
  const secret = generateApiKey();
  const now = new Date(ctx.now());
  const row = await ctx.db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(apiKeys)
      .values({
        userId: user.id,
        name: input.name,
        keyHash: hashToken(secret),
        keyPrefix: secret.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8),
        createdAt: now,
        expiresAt: new Date(now.getTime() + API_KEY_TTL_MS),
      })
      .returning();
    if (!inserted) throw new Error('api key insert returned no row');
    await recordAudit(tx, {
      actorUserId: user.id,
      action: 'auth.api_key.created',
      targetType: 'api_key',
      targetId: inserted.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return inserted;
  });
  return { key: summary(row, ctx.now()), secret };
}

/** @rfc RFC-82 R7 */
export async function listApiKeys(ctx: AuthContext, user: UserRow): Promise<ApiKeyList> {
  const rows = await ctx.db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
  return {
    eligible: await holdsAdminRole(ctx.db, user.id),
    keys: rows.map((r) => summary(r, ctx.now())),
  };
}

/** @rfc RFC-82 R7, R8 */
export async function revokeApiKey(
  ctx: AuthContext,
  input: { user: UserRow; id: string } & RequestMeta,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date(ctx.now()) })
      .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, input.user.id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (!row) throw new AppError('NOT_FOUND', 'API key not found');
    await recordAudit(tx, {
      actorUserId: input.user.id,
      action: 'auth.api_key.revoked',
      targetType: 'api_key',
      targetId: row.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts apps/api/src/auth/api-keys.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/api-keys.ts apps/api/src/auth/api-keys.integration.test.ts
git commit -m "feat(api): API key service (RFC-82 R1-R3, R7, R8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Bearer authentication in the middleware chain

**Files:**
- Create: `apps/api/src/audit/via.ts`
- Modify:
  - `apps/api/src/http/env.ts` (add `apiKey?: { id: string }`)
  - `apps/api/src/http/middleware/session.ts` (`resolveSession` deps gain `now?: () => number`; Bearer branch; `requireSession` checks `session`)
  - `apps/api/src/http/origin-check.ts`
  - `apps/api/src/auth/rate-limit.ts` (`apiKey` and `apiKeyCreate` rules)
  - `apps/api/src/http/middleware/rate-limit.ts` (`globalRateLimit`)
  - `apps/api/src/audit/audit.ts` (merge `via`)
  - `apps/api/src/app.ts` (pass `now` to `resolveSession`)
- Test: `apps/api/src/http/api-key-auth.integration.test.ts`, plus new cases in `apps/api/src/http/origin-check.test.ts`

**Interfaces:**
- Consumes: `bearerToken`, `findUsableKey`, `generateApiKey` (Task 3); `hashToken`
- Produces:
  - `auditVia: AsyncLocalStorage<{ apiKeyId: string }>`
  - `RATE_LIMITS.apiKey`, `RATE_LIMITS.apiKeyCreate`
  - context variable `apiKey`

- [ ] **Step 1: Write the failing integration test**

`apps/api/src/http/api-key-auth.integration.test.ts` inserts keys directly, because the service already has its own tests:

```ts
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../test/helpers/app.ts';
import { lastAudit } from '../../test/helpers/audit.ts';
import { adminRoleId } from '../../test/helpers/roles.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser } from '../../test/helpers/users.ts';
import { generateApiKey } from '../auth/api-keys.ts';
import { hashToken } from '../auth/tokens.ts';
import { apiKeys } from '../db/schema/api-keys.ts';

describe('RFC-82 R3-R6, R8, R9 Bearer authentication', () => {
  const t = useTestApp();

  async function adminWithKey() {
    const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const raw = generateApiKey();
    const [key] = await t.db
      .insert(apiKeys)
      .values({ userId: user.id, name: 'k', keyHash: hashToken(raw), keyPrefix: raw.slice(8, 16), expiresAt: new Date(t.clock.now + 86_400_000) })
      .returning();
    return { user, raw, key: key! };
  }
  const bearer = (raw: string) => ({ authorization: `Bearer ${raw}` });

  it('R3 a valid key reaches a permission-guarded route as its owner', async () => {
    const { raw } = await adminWithKey();
    const res = await call(t.app, 'GET', '/api/admin/roles', { headers: bearer(raw), origin: null });
    expect(res.status).toBe(200);
  });

  it('R3 an unknown key answers 401 even on a public route', async () => {
    const res = await call(t.app, 'POST', '/api/auth/login', {
      headers: bearer('tr_live_nope'),
      origin: null,
      body: { email: 'a@b.test', password: 'x' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('R4 a cookie and a key together answer 401', async () => {
    const { user, raw } = await adminWithKey();
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'GET', '/api/admin/roles', { cookie, headers: bearer(raw) });
    expect(res.status).toBe(401);
  });

  it('R5 a Bearer-only write needs no Origin; a cookie write still does', async () => {
    const { user, raw } = await adminWithKey();
    const res = await call(t.app, 'POST', '/api/admin/roles', {
      headers: bearer(raw),
      origin: null,
      body: { name: `r-${Date.now()}`, permissions: [] },
    });
    expect(res.status).not.toBe(403);
    const { cookie } = await loginAs(t, user);
    const cookieRes = await call(t.app, 'POST', '/api/admin/roles', { cookie, origin: null, body: { name: 'x', permissions: [] } });
    expect((await cookieRes.json()).error.code).toBe('SECURITY_INVALID_ORIGIN');
  });

  it('R6 self-service routes refuse a key', async () => {
    const { raw } = await adminWithKey();
    for (const [method, path] of [['GET', '/api/auth/me'], ['GET', '/api/me/sessions'], ['GET', '/api/help']] as const) {
      const res = await call(t.app, method, path, { headers: bearer(raw), origin: null });
      expect(res.status, path).toBe(401);
    }
  });

  it('R8 audit entries written with a key carry via and apiKeyId', async () => {
    const { user, raw, key } = await adminWithKey();
    await call(t.app, 'POST', '/api/admin/roles', { headers: bearer(raw), origin: null, body: { name: `r-${Date.now()}`, permissions: [] } });
    expect((await lastAudit(t.db, user.id))?.metadata).toMatchObject({ via: 'api_key', apiKeyId: key.id });
  });
});
```

Before running, check `POST /api/admin/roles`'s body schema in `packages/contracts/src/roles.ts` and adjust the body to one it accepts. The test needs a permission-guarded write that audits; `admin/roles` is one.

- [ ] **Step 2: Add a unit case to `origin-check.test.ts`**

```ts
it('RFC-82 R5 exempts a Bearer request without cookies', async () => {
  const app = new Hono<AppEnv>().use(originCheck('https://app.test')).post('/x', (c) => c.text('ok'));
  app.onError(createErrorHandler(captureLogger().logger));
  expect((await app.request('/x', { method: 'POST', headers: { authorization: 'Bearer tr_live_x' } })).status).toBe(200);
  expect(
    (await app.request('/x', { method: 'POST', headers: { authorization: 'Bearer tr_live_x', cookie: 'a=b' } })).status,
  ).toBe(403);
});
```

Match the imports and setup already used in `origin-check.test.ts`.

- [ ] **Step 3: Run to verify failure**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts apps/api/src/http/api-key-auth.integration.test.ts apps/api/src/http/origin-check.test.ts`
Expected: FAIL. The key is ignored today, so R3 gets 401 and R5 gets 403.

- [ ] **Step 4: Implement**

`apps/api/src/audit/via.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

/** Set for the lifetime of a key-authenticated request. @rfc RFC-82 R8 */
export const auditVia = new AsyncLocalStorage<{ apiKeyId: string }>();
```

`apps/api/src/audit/audit.ts`, inside `recordAudit`, replace `const metadata = entry.metadata ?? {};` with:

```ts
  const via = auditVia.getStore();
  const metadata = via
    ? { ...entry.metadata, via: 'api_key', apiKeyId: via.apiKeyId }
    : (entry.metadata ?? {});
```

Also add `import { auditVia } from './via.ts';` and add `@rfc RFC-82 R8` to the JSDoc.

`apps/api/src/http/env.ts`: add `apiKey?: { id: string };` to `Variables`.

`apps/api/src/http/middleware/session.ts`:
- `resolveSession` takes `deps: { sessions: SessionStore; db: Db; now?: () => number }`. At the top of the returned middleware:

```ts
    const raw = bearerToken(c.req.header('authorization'));
    const rawId = getCookie(c, SESSION_COOKIE);
    if (raw !== null) {
      // RFC-82 R3, R4: a Bearer header authenticates or the request stops here.
      if (rawId) throw new AppError('AUTH_UNAUTHENTICATED', 'Use a session or an API key, not both');
      const found = await findUsableKey({ db: deps.db, now: deps.now ?? Date.now }, raw);
      if (!found) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
      c.set('user', found.user);
      c.set('apiKey', { id: found.id });
      return auditVia.run({ apiKeyId: found.id }, () => next());
    }
```

  The existing cookie branch follows unchanged, reusing `rawId`. Add `@rfc RFC-82 R3, R4` to the JSDoc.
- `requireSession`: change the check to `if (!c.get('session'))` and add `@rfc RFC-82 R6`.

`apps/api/src/http/origin-check.ts`:

```ts
    const bearerOnly =
      c.req.header('authorization')?.startsWith('Bearer ') === true && !c.req.header('cookie');
    if (!bearerOnly && !SAFE_METHODS.has(c.req.method) && c.req.header('origin') !== appOrigin) {
```

Add `@rfc RFC-82 R5`.

`apps/api/src/auth/rate-limit.ts`, inside `RATE_LIMITS`:

```ts
  // RFC-82 R9: scripts send far more than a person clicking.
  apiKey: { limit: 3000, windowMs: 10 * MINUTE },
  // RFC-82 R2: guards the TOTP code asked at key creation.
  apiKeyCreate: { limit: 5, windowMs: QUARTER_HOUR },
```

`apps/api/src/http/middleware/rate-limit.ts`, in `globalRateLimit`:

```ts
    const apiKey = c.get('apiKey');
    const session = c.get('session');
    const decision = apiKey
      ? await limiter.hit('global:api_key', apiKey.id, RATE_LIMITS.apiKey)
      : session
        ? await limiter.hit('global:session', session.id, RATE_LIMITS.globalSession)
        : await limiter.hit('global:ip', ipKey(c), RATE_LIMITS.globalIp);
```

Add `@rfc RFC-82 R9`.

`apps/api/src/app.ts`: `app.use(resolveSession({ sessions: deps.sessions, db: deps.db, now: deps.now }));`

- [ ] **Step 5: Run the new tests, then the whole API suite**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api test`
Expected: PASS. If an existing test relied on `requireSession` accepting a user without a session, it builds its own app; give it a session with `loginAs` instead of loosening the guard.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): Bearer API key authentication (RFC-82 R3-R6, R8, R9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Key management routes

**Files:**
- Modify: `apps/api/src/http/routes/me.ts`, `apps/api/src/http/self-service-routes.ts`, `apps/api/src/routes-guarded.integration.test.ts` (the "exposes exactly the routes" list)
- Test: `apps/api/src/http/routes/me-api-keys.integration.test.ts`

**Interfaces:**
- Consumes:
  - `createApiKey`, `listApiKeys`, `revokeApiKey` (Task 3)
  - `createApiKeyBodySchema` (Task 2)
  - `rateLimit` and `RATE_LIMITS.apiKeyCreate` (Task 4)
- Produces:
  - `GET /api/me/api-keys` → `{ data: ApiKeyList }`
  - `POST /api/me/api-keys` → `{ data: CreateApiKeyResponse }`
  - `DELETE /api/me/api-keys/:id` → `{ data: { status: 'ok' } }`

- [ ] **Step 1: Write the failing route test**

`apps/api/src/http/routes/me-api-keys.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { adminRoleId } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser, DEFAULT_PASSWORD } from '../../../test/helpers/users.ts';
import { generateTotpCode, generateTotpSecret } from '../../auth/totp.ts';

describe('RFC-82 R2, R6, R7 /api/me/api-keys', () => {
  const t = useTestApp();

  it('creates, lists, uses and revokes a key; the key cannot manage keys', async () => {
    const secret = generateTotpSecret();
    const { user } = await createUser(t.db, { totpSecret: secret, roles: [await adminRoleId(t.db)] });
    const { cookie } = await loginAs(t, user);

    const created = await call(t.app, 'POST', '/api/me/api-keys', {
      cookie,
      body: { name: 'laptop', password: DEFAULT_PASSWORD, code: generateTotpCode(secret, t.clock.now) },
    });
    expect(created.status).toBe(200);
    const { data } = await created.json();
    expect(data.secret).toMatch(/^tr_live_/);

    const list = await (await call(t.app, 'GET', '/api/me/api-keys', { cookie })).json();
    expect(list.data).toMatchObject({ eligible: true, keys: [{ id: data.key.id, state: 'active' }] });

    const viaKey = await call(t.app, 'GET', '/api/me/api-keys', { headers: { authorization: `Bearer ${data.secret}` }, origin: null });
    expect(viaKey.status).toBe(401);

    const del = await call(t.app, 'DELETE', `/api/me/api-keys/${data.key.id}`, { cookie });
    expect(del.status).toBe(200);
    const after = await call(t.app, 'GET', '/api/admin/roles', { headers: { authorization: `Bearer ${data.secret}` }, origin: null });
    expect(after.status).toBe(401);
  });

  it('R7 a contributor sees eligible false; R2 creation is rate-limited per user', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const list = await (await call(t.app, 'GET', '/api/me/api-keys', { cookie })).json();
    expect(list.data).toEqual({ eligible: false, keys: [] });
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = (await call(t.app, 'POST', '/api/me/api-keys', { cookie, body: { name: 'x', password: 'x', code: '000000' } })).status;
    }
    expect(last).toBe(429);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm vitest run --config vitest.config.ts apps/api/src/http/routes/me-api-keys.integration.test.ts`
Expected: FAIL, 404 on `/api/me/api-keys`.

- [ ] **Step 3: Implement the routes**

In `apps/api/src/http/routes/me.ts`, chain the following after `.delete('/sessions/:id', …)`, and add `@rfc RFC-82 R2, R6, R7` to `meRoutes`' JSDoc:

```ts
    .get('/api-keys', requireSession, async (c) =>
      c.json({ data: await listApiKeys(ctx, currentUser(c)) }),
    )
    .post(
      '/api-keys',
      requireSession,
      rateLimit(ctx.limiter, [
        { scope: 'apiKeyCreate', rule: RATE_LIMITS.apiKeyCreate, key: (c) => c.get('user')?.id ?? null },
      ]),
      validate('json', createApiKeyBodySchema),
      async (c) =>
        c.json({
          data: await createApiKey(ctx, {
            user: currentUser(c),
            ...c.req.valid('json'),
            ip: clientIp(c),
            userAgent: userAgent(c),
          }),
        }),
    )
    .delete('/api-keys/:id', requireSession, validate('param', z.strictObject({ id: z.uuid() })), async (c) => {
      await revokeApiKey(ctx, {
        user: currentUser(c),
        id: c.req.valid('param').id,
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      return c.json({ data: { status: 'ok' as const } });
    });
```

Add these entries to `SELF_SERVICE_ROUTES`, and to the expected list in `routes-guarded.integration.test.ts`'s "exposes exactly the routes" test:

```ts
  'GET /api/me/api-keys',
  'POST /api/me/api-keys',
  'DELETE /api/me/api-keys/:id',
```

Add `@rfc RFC-82 R6` to the `SELF_SERVICE_ROUTES` JSDoc.

- [ ] **Step 4: Run the API suite**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/api test`
Expected: PASS, including both guard meta-tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): /api/me/api-keys create, list, revoke (RFC-82 R2, R6, R7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Settings › API keys

**Files:**
- Create: `apps/web/src/components/settings/ApiKeysSection.tsx`, `apps/web/src/components/settings/ApiKeysSection.test.tsx`
- Modify: `apps/web/src/api/me.ts`, `apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/pages/SettingsPage.test.tsx` (mock `listApiKeys`)

**Interfaces:**
- Consumes: `GET/POST /api/me/api-keys`, `DELETE /api/me/api-keys/:id` (Task 5); `apiKeyListSchema`, `createApiKeyResponseSchema` (Task 2)
- Produces:
  - `listApiKeys(): Promise<ApiKeyList>`
  - `createApiKey(body: CreateApiKeyBody): Promise<CreateApiKeyResponse>`
  - `revokeApiKey(id: string): Promise<void>`
  - `ApiKeysSection`

- [ ] **Step 1: Write the failing component test**

`apps/web/src/components/settings/ApiKeysSection.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ApiKeysSection } from './ApiKeysSection.tsx';

const me = vi.hoisted(() => ({ listApiKeys: vi.fn(), createApiKey: vi.fn(), revokeApiKey: vi.fn() }));
vi.mock('../../api/me.ts', () => me);

const KEY = {
  id: '0199a1b2-0000-7000-8000-000000000001',
  name: 'laptop',
  prefix: 'AbCdEfGh',
  createdAt: '2026-09-26T10:00:00.000Z',
  expiresAt: '2026-12-25T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  state: 'active' as const,
};

beforeEach(() => {
  for (const fn of Object.values(me)) fn.mockReset();
});

describe('RFC-82 R7 ApiKeysSection', () => {
  it('renders nothing for a user who is not eligible', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: false, keys: [] });
    const { container } = renderWithProviders(<ApiKeysSection />, { me: ME });
    await waitFor(() => expect(me.listApiKeys).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('creates a key, shows the secret once, and revokes a key', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: true, keys: [KEY] });
    me.createApiKey.mockResolvedValue({ key: { ...KEY, id: '0199a1b2-0000-7000-8000-000000000002' }, secret: 'tr_live_SECRET' });
    me.revokeApiKey.mockResolvedValue(undefined);
    renderWithProviders(<ApiKeysSection />, { me: ME });

    expect(await screen.findByText('laptop')).toBeInTheDocument();
    expect(screen.getByText('tr_live_AbCdEfGh…')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Key name'), 'script');
    await userEvent.type(screen.getByLabelText('Current password'), 'pw');
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(me.createApiKey).toHaveBeenCalledWith({ name: 'script', password: 'pw', code: '123456' });
    expect(await screen.findByText('tr_live_SECRET')).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Revoke laptop' }));
    expect(me.revokeApiKey).toHaveBeenCalledWith(KEY.id);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/web exec vitest run src/components/settings/ApiKeysSection.test.tsx`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Add the client calls to `apps/web/src/api/me.ts`**

```ts
/** @rfc RFC-82 R7 */
export async function listApiKeys(): Promise<ApiKeyList> {
  const { data } = await apiFetch('/me/api-keys', dataEnvelopeSchema(apiKeyListSchema));
  return data;
}

/** @rfc RFC-82 R2 */
export async function createApiKey(body: CreateApiKeyBody): Promise<CreateApiKeyResponse> {
  const { data } = await apiFetch('/me/api-keys', dataEnvelopeSchema(createApiKeyResponseSchema), {
    method: 'POST',
    json: body,
  });
  return data;
}

/** @rfc RFC-82 R7 */
export async function revokeApiKey(id: string): Promise<void> {
  await apiFetch(`/me/api-keys/${id}`, dataEnvelopeSchema(okStatusSchema), { method: 'DELETE' });
}
```

Extend the existing `@treerepro/contracts` import with `apiKeyListSchema`, `createApiKeyResponseSchema`, `ApiKeyList`, `CreateApiKeyBody` and `CreateApiKeyResponse`.

- [ ] **Step 4: Write `ApiKeysSection.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { createApiKey, listApiKeys, revokeApiKey } from '../../api/me.ts';
import { GENERIC_MESSAGE } from '../../lib/errors.ts';
import { Alert, Badge, Button, Field, Input, Section, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const KEYS_KEY = ['me', 'api-keys'] as const;

// Not exported: no @rfc tag needed (RFC-00 R6 applies to exports only).
function formatWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function createErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  switch (error.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Your current password is incorrect.';
    case 'AUTH_TOTP_INVALID':
      return 'The verification code is not valid.';
    case 'AUTH_TOTP_NOT_ENABLED':
      return 'Enable two-factor authentication first.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    default:
      return GENERIC_MESSAGE;
  }
}

const TONE = { active: 'green', expired: 'gray', revoked: 'gray' } as const;

/**
 * Hidden unless the API says the user may hold keys; the secret is shown once
 * and leaves the mutation cache with the section (gcTime 0, as PasswordSection).
 * @rfc RFC-82 R1, R2, R7
 */
export function ApiKeysSection() {
  const ids = { name: useId(), password: useId(), code: useId() };
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const keys = useQuery({ queryKey: KEYS_KEY, queryFn: listApiKeys });
  const create = useMutation({
    mutationFn: createApiKey,
    gcTime: 0,
    onSuccess: (out) => {
      setSecret(out.secret);
      formRef.current?.reset();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS_KEY }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS_KEY }),
  });

  if (!keys.data?.eligible) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSecret(null);
    create.mutate(
      {
        name: String(data.get('name') ?? ''),
        password: String(data.get('password') ?? ''),
        code: String(data.get('code') ?? ''),
      },
      // Drops the password and code from `variables` right away (RFC-21 R7 pattern).
      { onSettled: () => create.reset() },
    );
  }

  return (
    <Section id="api-keys" title="API keys" description="Personal keys for scripts. Each key expires after 90 days.">
      {secret ? (
        <Alert tone="success">
          Copy this key now. It will not be shown again.
          <code className="mt-2 block break-all font-mono text-step--1">{secret}</code>
        </Alert>
      ) : null}
      {create.isError ? <Alert tone="error">{createErrorMessage(create.error)}</Alert> : null}
      {revoke.isError ? <Alert tone="error">{GENERIC_MESSAGE}</Alert> : null}
      {keys.data.keys.length > 0 ? (
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th>Expires</Th>
              <Th>Last used</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {keys.data.keys.map((k) => (
              <Tr key={k.id}>
                <Td>
                  {k.name} <Badge tone={TONE[k.state]}>{k.state}</Badge>
                </Td>
                <Td className="font-mono">{`tr_live_${k.prefix}…`}</Td>
                <Td>{formatWhen(k.expiresAt)}</Td>
                <Td>{formatWhen(k.lastUsedAt)}</Td>
                <Td className="text-right">
                  {k.state === 'active' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Revoke ${k.name}`}
                      pending={revoke.isPending && revoke.variables === k.id}
                      onClick={() => revoke.mutate(k.id)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
      <form ref={formRef} onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
        <Field id={ids.name} label="Key name">
          <Input id={ids.name} name="name" maxLength={60} required />
        </Field>
        <Field id={ids.password} label="Current password">
          <Input id={ids.password} name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Field id={ids.code} label="Verification code">
          <Input id={ids.code} name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </Field>
        <div>
          <Button type="submit" pending={create.isPending}>
            Create key
          </Button>
        </div>
      </form>
    </Section>
  );
}
```

If `Badge` has no `gray` tone, use the neutral tone that `apps/web/src/components/ui` exports. Check `Badge`'s props before running.

- [ ] **Step 5: Mount it**

In `SettingsPage.tsx`, import `ApiKeysSection` and render `<ApiKeysSection />` between `<TotpSection />` and `<SessionsSection … />`. In `SettingsPage.test.tsx`, add `listApiKeys: vi.fn().mockResolvedValue({ eligible: false, keys: [] }), createApiKey: vi.fn(), revokeApiKey: vi.fn()` to the `../api/me.ts` mock.

- [ ] **Step 6: Run the web tests, typecheck and lint**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm --filter @treerepro/web test && pnpm typecheck && pnpm lint && pnpm rfc:check`
Expected: all PASS.

- [ ] **Step 7: Visual check (required before any PR)**

1. From the worktree, start the dev web container against it: `docker compose up -d web`. Apply the migration with `docker compose up migrate` and restart `api` so 0042 is live.
2. Sign in as an admin with TOTP enabled and open `/app/settings`. Take screenshots of the empty section, the section after creating a key (secret shown), and after revoking it. Take one screenshot at 390 px width.
3. Show the screenshots to Rafael and adjust on request. At close-out, run `up -d web` from the main checkout again.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): Settings > API keys (RFC-82 R1, R2, R7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end and handbook

**Files:**
- Modify: `apps/e2e/tests/critical-flow.spec.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: the serial `critical-flow` state (`totpSecret`, the admin `context`) and `codeFor(secret, offset)`.

- [ ] **Step 1: Add the E2E step**

In `critical-flow.spec.ts`, directly after the test `RFC-23 R2-R3 enables two-factor …`, add (use the variable names the file already holds for the admin page and context):

```ts
  test('RFC-82 R1-R3 creates an API key in Settings and reads the pending queue with it', async () => {
    await page.goto(`${BASE_URL}/app/settings`);
    const section = page.locator('#api-keys');
    await section.getByLabel('Key name').fill('e2e');
    await section.getByLabel('Current password').fill(currentPassword);
    await section.getByLabel('Verification code').fill(codeFor(totpSecret, 2));
    await section.getByRole('button', { name: 'Create key' }).click();
    const secret = (await section.locator('code').textContent())?.trim();
    expect(secret).toMatch(/^tr_live_/);

    const res = await page.request.get(`${BASE_URL}/api/records/pending/traits`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status()).toBe(200);
  });
```

`page.request` shares the page's cookies, and R4 refuses cookie plus Bearer. If the request carries the session cookie, use `playwright.request.newContext()` (a context with no cookies) for the Bearer call instead.

- [ ] **Step 2: Run the E2E suite**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm test:e2e`
Expected: PASS.

- [ ] **Step 3: Add a handbook line**

In `CLAUDE.md` under **Commands**, after the Admin API bullet:

```markdown
- API keys (`GET|POST /api/me/api-keys`, `DELETE /api/me/api-keys/:id`; Settings › API keys, admin system role only, password + TOTP to create, 90-day expiry): a key sent as `Authorization: Bearer tr_live_…` reaches every permission-guarded route as its owner and never a self-service one: RFC-82.
```

- [ ] **Step 4: Full verification**

Run: `PATH=/Users/rafael/.asdf/installs/nodejs/24.21.0/bin:$PATH pnpm lint && pnpm typecheck && pnpm test && pnpm rfc:check`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e CLAUDE.md
git commit -m "test(e2e): API key created in Settings reads the pending queue (RFC-82)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Close-out (not a task)

Follow the project routine: one CodeRabbit run on the local branch, `git rebase origin/main`, then open the PR. Merging, restarting the dev stack and removing the `in-progress` label follow the usual close-out once Rafael merges. Plans 14b (batch) and 14c (docs) each get their own plan after 14a merges.
