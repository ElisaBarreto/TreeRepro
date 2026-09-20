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

## A caught unique violation leaves the transaction unusable
**Symptom:** a `catch (isUniqueViolation(err))` branch inside `db.transaction` re-reads the row the race created and fails with `25P02 current transaction is aborted`.
**Cause:** PostgreSQL aborts the whole transaction on any statement error; only a `ROLLBACK` (or a savepoint taken before the statement) makes it usable again. Catching the error in JavaScript does not undo that.
**Fix:** Insert with `.onConflictDoNothing().returning(...)` and re-read when nothing came back — no error is raised, so the transaction stays open (`createReferenceFromDoi`, `ensurePersonalObservation`). Where an error really must be caught, take the savepoint explicitly with a nested `tx.transaction(...)`, as the schema tests do.


## A streaming cursor cannot take a Drizzle fragment directly
**Symptom:** A query that must stream (`client\`…\`.cursor(n)`, RFC-66 R5) also needs the shared visibility predicates (`speciesVisible`, `traitVisible`, RFC-33 R2), which are Drizzle `SQL` fragments; interpolating one into a postgres.js template inserts the object, not SQL.
**Cause:** Drizzle has no cursor API for postgres-js, and postgres.js knows nothing about Drizzle's `SQL` chunks. Copying the predicate into postgres.js syntax would give RFC-33 R2 a second home.
**Fix:** Write the whole query as a Drizzle `sql` template, render it with `new PgDialect().sqlToQuery(query)` (text with `$n` placeholders plus the parameter array), and hand both to `client.unsafe(text, params).cursor(n)` — `unsafe` only in postgres.js's sense of "text not built by its own tag"; every value still travels as a bound parameter (`apps/api/src/dataset/export.ts`). `cursor()` forces the extended protocol even when the rendered query has no parameter.
