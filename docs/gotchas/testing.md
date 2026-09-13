# Testing

## Integration tests share one database and run in parallel
**Symptom:** An assertion on "the newest audit row for this action" intermittently reads a row written by another test — a different `targetId`, a different `metadata.reason` — and passes on rerun (issue #38).
**Cause:** `test/global-setup.ts` starts one PostgreSQL container for the whole `api:integration` project and Vitest runs test files in parallel workers. Any query that selects the latest row of a shared table without naming this test's own data races with every other file that writes the same table (`routes-guarded`, `totp`, `password` all produce `auth.login.failure`, for example).
**Fix:** Scope every lookup to something only the test knows: `lastAudit(t.db, action, { actorUserId | targetId | ip })` in `test/helpers/audit.ts` refuses to run unscoped. For entries with no user (unknown email, rate limiting) pick the request IP with `randomIp()`, pass it to `call(...)`, and scope by it — the column is encrypted, so the helper matches it after decryption. Never assert on `ORDER BY id DESC LIMIT 1` alone, and do not rely on uuidv7 ordering across connections either.

## A property test fails with a counterexample
**Symptom:** A `*.property.test.ts` file in `apps/api/src` fails with `Property failed after N tests`, a `Counterexample: [...]` line and a `Seed: …` line, sometimes only in CI.
**Cause:** These files use `fast-check` (property-based testing, also what OpenSSF Scorecard's `Fuzzing` check looks for): every run draws new random inputs, so a failure is a real input the example tests never tried, not flakiness. The counterexample is already shrunk to the smallest failing case.
**Fix:** Reproduce it deterministically with the printed seed and path, `fc.assert(fc.property(...), { seed: <seed>, path: '<path>' })`, then fix the code or, when the property was stated too broadly, narrow the arbitrary and say why in a comment. Keep the guarded invariants in the property file and the exact shapes (formats, error classes) in the sibling example file.
