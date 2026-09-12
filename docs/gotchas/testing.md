# Testing

## Integration tests share one database and run in parallel
**Symptom:** An assertion on "the newest audit row for this action" intermittently reads a row written by another test — a different `targetId`, a different `metadata.reason` — and passes on rerun (issue #38).
**Cause:** `test/global-setup.ts` starts one PostgreSQL container for the whole `api:integration` project and Vitest runs test files in parallel workers. Any query that selects the latest row of a shared table without naming this test's own data races with every other file that writes the same table (`routes-guarded`, `totp`, `password` all produce `auth.login.failure`, for example).
**Fix:** Scope every lookup to something only the test knows: `lastAudit(t.db, action, { actorUserId | targetId | ip })` in `test/helpers/audit.ts` refuses to run unscoped. For entries with no user (unknown email, rate limiting) pick the request IP with `randomIp()`, pass it to `call(...)`, and scope by it — the column is encrypted, so the helper matches it after decryption. Never assert on `ORDER BY id DESC LIMIT 1` alone, and do not rely on uuidv7 ordering across connections either.
