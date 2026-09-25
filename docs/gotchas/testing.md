# Testing

## Integration tests share one database and run in parallel
**Symptom:** An assertion on "the newest audit row for this action" intermittently reads a row written by another test — a different `targetId`, a different `metadata.reason` — and passes on rerun (issue #38).
**Cause:** `test/global-setup.ts` starts one PostgreSQL container for the whole `api:integration` project and Vitest runs test files in parallel workers. Any query that selects the latest row of a shared table without naming this test's own data races with every other file that writes the same table (`routes-guarded`, `totp`, `password` all produce `auth.login.failure`, for example).
**Fix:** Scope every lookup to something only the test knows: `lastAudit(t.db, action, { actorUserId | targetId | ip })` in `test/helpers/audit.ts` refuses to run unscoped. For entries with no user (unknown email, rate limiting) pick the request IP with `randomIp()`, pass it to `call(...)`, and scope by it — the column is encrypted, so the helper matches it after decryption. Never assert on `ORDER BY id DESC LIMIT 1` alone, and do not rely on uuidv7 ordering across connections either.

## `set transaction isolation level repeatable read` freezes nothing by itself
**Symptom:** A before/after delta test that runs inside `withRollback` under `repeatable read` still moves by one more than its fixture, only in CI and only on a counter with a time window — `health.integration.test.ts`'s `activity.records7d` read 5 and 6 where the fixture adds 4, while the unwindowed `dataset.records` of the same payload read 4 (issue #123).
**Cause:** `SET TRANSACTION` and `SHOW transaction_isolation` take no snapshot; PostgreSQL pins the repeatable-read snapshot at the first statement that needs one, a `SELECT`. So the snapshot is taken by the first statement of the `before` call — after `computePlatformHealth` has already read its `end` bound from the JS clock. A sibling file's row committed in that gap carries a `created_at` later than `before`'s `end` and earlier than `after`'s: it is in the frozen snapshot, in only one of the two windows, and the delta counts it. Verified against Postgres 18: after `SET` + `SHOW` alone a concurrent commit is still visible; after one `select 1` it is not.
**Fix:** Pin the snapshot on purpose — `await tx.execute(sql\`select 1\`)` — before the first call whose bounds come from the clock (`freezeSnapshot` in `health.integration.test.ts` does this). A helper whose first real statement is the compute itself is fine when that compute has no clock-derived bound (`coverage`, `dashboard`, `proposals`), because then both calls see the same rows and the same predicate.

## A property test fails with a counterexample
**Symptom:** A `*.property.test.ts` file in `apps/api/src` fails with `Property failed after N tests`, a `Counterexample: [...]` line and a `Seed: …` line, sometimes only in CI.
**Cause:** These files use `fast-check` (property-based testing, also what OpenSSF Scorecard's `Fuzzing` check looks for): every run draws new random inputs, so a failure is a real input the example tests never tried, not flakiness. The counterexample is already shrunk to the smallest failing case.
**Fix:** Reproduce it deterministically with the printed seed and path, `fc.assert(fc.property(...), { seed: <seed>, path: '<path>' })`, then fix the code or, when the property was stated too broadly, narrow the arbitrary and say why in a comment. Keep the guarded invariants in the property file and the exact shapes (formats, error classes) in the sibling example file.

## The e2e stack is a separate Compose project on its own ports
**Symptom:** `pnpm test:e2e` while the dev stack is up — port 80/8025 already in use, or `down -v` wiping the dev database.
**Cause:** `-p treerepro-e2e`, 8080 / 8026; explicit `-f` flags override the `.env` `COMPOSE_FILE`, so the dev overlay never leaks in.
**Fix:** Nothing to do — the two stacks are isolated by project name and port; `down -v` at the end drops the e2e project's volumes, the dev stack's stay untouched.

## A TOTP code is accepted once per step
**Symptom:** Enrolling and then signing in with the same computed code answers `AUTH_TOTP_INVALID` on the second use.
**Cause:** RFC-23 R4's replay guard rejects a code already consumed at its time step.
**Fix:** Enrol with `codeFor(secret)` and sign in with `codeFor(secret, 1)` (the next step, inside the ±1 window) — reusing the enrolment code is the replay the guard exists to catch.

## `seed-admin` prints the invitation link — the runner reads it from stdout
**Symptom:** Wanting to fetch the first administrator's invitation link from an inbox that does not exist yet.
**Cause:** The first account has no mailbox to read from; only later invitations go through SMTP.
**Fix:** `scripts/e2e.sh` reads `seed-admin`'s stdout for `Link (expires …): …` and passes it to Playwright as `E2E_ADMIN_INVITE_LINK`. User B's invitation, sent by the admin through the app, has no such log line — its link comes from Mailpit's REST API (`/api/v1/search?query=to:<email>`, then `/api/v1/message/<ID>`, text body).

## `critical-flow.spec.ts` spends the whole admin login rate-limit budget
**Symptom:** A second admin sign-in added to `critical-flow.spec.ts` intermittently answers `AUTH_RATE_LIMITED` (or starves a later test's login).
**Cause:** RFC-24 R3 limits `login` to 5 attempts per 15 minutes; `critical-flow.spec.ts` already spends that budget on its own admin sign-in.
**Fix:** Never add an admin sign-in to that file. Every other E2E spec authenticates as admin through `adminContext()` (saved storage state) and provisions other users with `inviteAndActivate()`.

## E2E spec files run in parallel against one stack
**Symptom:** An e2e spec passes alone (`pnpm test:e2e -- -g …`) but fails in the full run: a count is off by one, a list holds a row the spec did not create, or `ADMIN_STATE` suddenly answers 401.
**Cause:** `playwright.config.ts` runs three workers: spec files in parallel, the tests inside one file in order (issue #165). Every file shares the same database, Redis and Mailpit. `critical-flow.spec.ts` resets the admin's password (revoking every admin session) and turns on its TOTP, so it is its own Playwright project that the `chromium` project depends on: it finishes, saves `ADMIN_STATE` again, and only then do the other files start.
**Fix:** A spec creates its own users (`inviteAndActivate`, unique e-mail), traits, species and plots, and asserts only on those or on figures scoped to them; never on a global total another file can move. Anything that, like `critical-flow`, changes the admin's credentials or sessions belongs in that first project.

## `getByText` / `getByRole` name matching is substring by default in Playwright
**Symptom:** Strict-mode violations ("resolved to 2 elements") for `getByText('suspended')` (a status badge reading "suspended" and a caption reading "Suspended 2026-…") or `getByRole('button', { name: 'Sign out' })` on the settings page ("Sign out everywhere", "Sign out <agent>").
**Cause:** Playwright's string `name`/text locators match by substring by default; Testing Library's string `name` matcher is exact by default — the opposite convention — so instincts carried over from component tests pick the wrong default here.
**Fix:** Pass `{ exact: true }` wherever a longer sibling name exists (`critical-flow.spec.ts`).

## jsdom 30.1.0 breaks `.rejects.toThrow` in the `web` project
**Symptom:** After bumping `jsdom` to 30.1.0, `pnpm test` fails `apps/web/src/api/client.test.ts > rejects paths that do not start with /` with `expected [Function] to throw error matching /must start with \// but got ''`. Any `await expect(Promise.reject(new Error('x'))).rejects.toThrow(/x/)` in the `web` project fails the same way; the synchronous `toThrow` passes. It fails only when Vitest starts from the repository root (`pnpm test`, `pnpm exec vitest run --project web`); `vitest run` from `apps/web` passes.
**Cause:** A jsdom 30.1.0 regression (the release shipped several: jsdom/jsdom#4342, #4344, #4347, #4361). The thrown value is a correct `Error` with the expected message, so the matcher, not the code, is what breaks. Not bisected further.
**Fix:** `apps/web` stays on `jsdom` 30.0.1. Retry with the next jsdom release: bump, run `pnpm test` from the root, and drop this entry when it passes.
