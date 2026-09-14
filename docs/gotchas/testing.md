# Testing

## Integration tests share one database and run in parallel
**Symptom:** An assertion on "the newest audit row for this action" intermittently reads a row written by another test — a different `targetId`, a different `metadata.reason` — and passes on rerun (issue #38).
**Cause:** `test/global-setup.ts` starts one PostgreSQL container for the whole `api:integration` project and Vitest runs test files in parallel workers. Any query that selects the latest row of a shared table without naming this test's own data races with every other file that writes the same table (`routes-guarded`, `totp`, `password` all produce `auth.login.failure`, for example).
**Fix:** Scope every lookup to something only the test knows: `lastAudit(t.db, action, { actorUserId | targetId | ip })` in `test/helpers/audit.ts` refuses to run unscoped. For entries with no user (unknown email, rate limiting) pick the request IP with `randomIp()`, pass it to `call(...)`, and scope by it — the column is encrypted, so the helper matches it after decryption. Never assert on `ORDER BY id DESC LIMIT 1` alone, and do not rely on uuidv7 ordering across connections either.

## A property test fails with a counterexample
**Symptom:** A `*.property.test.ts` file in `apps/api/src` fails with `Property failed after N tests`, a `Counterexample: [...]` line and a `Seed: …` line, sometimes only in CI.
**Cause:** These files use `fast-check` (property-based testing, also what OpenSSF Scorecard's `Fuzzing` check looks for): every run draws new random inputs, so a failure is a real input the example tests never tried, not flakiness. The counterexample is already shrunk to the smallest failing case.
**Fix:** Reproduce it deterministically with the printed seed and path, `fc.assert(fc.property(...), { seed: <seed>, path: '<path>' })`, then fix the code or, when the property was stated too broadly, narrow the arbitrary and say why in a comment. Keep the guarded invariants in the property file and the exact shapes (formats, error classes) in the sibling example file.

## The e2e stack is a separate Compose project on its own ports
**Symptom:** Worry that `pnpm test:e2e` might collide with, or tear down, the development stack.
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

## `getByText` / `getByRole` name matching is substring by default in Playwright
**Symptom:** Strict-mode violations ("resolved to 2 elements") for `getByText('suspended')` (a status badge reading "suspended" and a caption reading "Suspended 2026-…") or `getByRole('button', { name: 'Sign out' })` on the settings page ("Sign out everywhere", "Sign out <agent>").
**Cause:** Playwright's string `name`/text locators match by substring by default; Testing Library's string `name` matcher is exact by default — the opposite convention — so instincts carried over from component tests pick the wrong default here.
**Fix:** Pass `{ exact: true }` wherever a longer sibling name exists (`critical-flow.spec.ts`).
