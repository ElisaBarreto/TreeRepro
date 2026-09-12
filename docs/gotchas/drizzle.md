# Drizzle ORM

## Equality on an `encryptedText` column never matches
**Symptom:** `db.select().from(users).where(eq(users.email, 'ada@example.com'))` returns no rows although the user exists.
**Cause:** `encryptedText` runs `toDriver` on the comparison value too, encrypting it with a fresh random IV (RFC-40 R2). The parameter is a new ciphertext that equals nothing stored. `LIKE`, `IN`, `ORDER BY` and unique constraints fail the same way.
**Fix:** Look rows up through the blind-index column (`users.email_hash = getPii().blindIndex(value)`, RFC-40 R5, R11). `audit.integration.test.ts` keeps a test that documents the failure mode.

## A ciphertext moved to another column will not decrypt
**Symptom:** `PiiDecryptError` on read after copying a value between columns or tables (a migration, a manual `UPDATE … SET a = b`).
**Cause:** The qualified column name `<table>.<column>` is the AES-GCM additional authenticated data (RFC-40 R2). Renaming a table or column changes the AAD as well.
**Fix:** Move PII through the application (read with the old column's AAD, write with the new one), never with SQL alone. A rename needs a re-encryption step like a key rotation (RFC-40 R7).
