# Drizzle ORM

## Equality on an `encryptedText` column never matches
**Symptom:** `db.select().from(users).where(eq(users.email, 'ada@example.com'))` returns no rows although the user exists.
**Cause:** `encryptedText` runs `toDriver` on the comparison value too, encrypting it with a fresh random IV (RFC-40 R2). The parameter is a new ciphertext that equals nothing stored. `LIKE`, `IN`, `ORDER BY` and unique constraints fail the same way.
**Fix:** Look rows up through the blind-index column (`users.email_hash = getPii().blindIndex(value)`, RFC-40 R5, R11). `audit.integration.test.ts` keeps a test that documents the failure mode.

## A ciphertext moved to another column will not decrypt
**Symptom:** `PiiDecryptError` on read after copying a value between columns or tables (a migration, a manual `UPDATE … SET a = b`).
**Cause:** The qualified column name `<table>.<column>` is the AES-GCM additional authenticated data (RFC-40 R2). Renaming a table or column changes the AAD as well.
**Fix:** Move PII through the application (read with the old column's AAD, write with the new one), never with SQL alone. A rename needs a re-encryption step like a key rotation (RFC-40 R7).

## Driver errors are two `cause` levels down
**Symptom:** `err.code === '23505'` is never true in a `catch` around a Drizzle query.
**Cause:** Drizzle throws `DrizzleQueryError` whose `cause` is the postgres.js `PostgresError`; the SQLSTATE lives on that inner error.
**Fix:** Use `isUniqueViolation` / `isForeignKeyViolation` / `isCheckViolation` from `apps/api/src/db/errors.ts`, which walk the cause chain.

## `drizzle-kit generate` needs the contracts package built
**Symptom:** `db:generate` fails to resolve `@treerepro/contracts` in a fresh checkout (`Cannot find module '…/@treerepro/contracts/dist/index.js'`).
**Cause:** drizzle-kit loads the schema through the package's `exports` (pointing at `dist/`, gitignored), not the `development` condition.
**Fix:** Run `pnpm --filter @treerepro/contracts build` first.
