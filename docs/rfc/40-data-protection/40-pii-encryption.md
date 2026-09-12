# RFC-40 — PII encryption

| Field | Value |
|---|---|
| Status | accepted |
| Category | data-protection |
| Supersedes | — |

## Context

Personal data of system users (name, email, IP address, user agent) must be unreadable in database dumps, backups and disk images. Encryption happens in the API process; the database never sees keys or plaintext.

## Rules

- **R1** PII columns are stored encrypted; plaintext is never persisted. Columns: `users.name`, `users.email`, `users.totp_secret` (RFC-20), `audit_log.ip`, `audit_log.user_agent` (RFC-41). Redis records holding PII use the same mechanism: session `ip` and `userAgent` (AAD `session.ip`, `session.userAgent`, RFC-22 R4) and the provisional TOTP secret (AAD `totp_setup.secret`, RFC-23 R2).
- **R2** Algorithm: AES-256-GCM with a fresh 12-byte random IV per encryption and a 16-byte authentication tag. Stored format: `v<version>:<iv>:<tag>:<ciphertext>`, each part base64url without padding. The additional authenticated data (AAD) is the qualified column name `<table>.<column>` in UTF-8; it is not stored. A ciphertext therefore decrypts only in the column it was written for: a value copied into another column or table fails R4.
- **R3** Keys are 32 bytes. Each key version is a secret file `pii_encryption_key_v<N>` containing 64 lowercase hex characters. The keyring maps version label (`v1`, `v2`, …) to key; the version named by `PII_CURRENT_KEY_VERSION` (default `v1`) encrypts; every version in the keyring can decrypt.
- **R4** Decrypting a malformed value, an unknown version, or a value whose authentication fails throws `PiiDecryptError`. No partial plaintext is ever returned.
- **R5** Blind index for equality lookups: `HMAC-SHA256(pii_hmac_key, normalize(value))` as lowercase hex, where `normalize` = Unicode NFKC → trim → lowercase. The HMAC key is a separate 32-byte secret `pii_hmac_key`.
- **R6** Keys never appear in logs, database rows, API responses or error messages.
- **R7** Rotation: add `pii_encryption_key_v<N+1>`, set `PII_CURRENT_KEY_VERSION=v<N+1>`, restart; re-encrypt rows in batches (each row read via the keyring and written with the current key); remove the old secret only after `SELECT count(*) … WHERE col LIKE 'v<N>:%'` is zero for every PII column. The new secret file must also be declared in Compose — under the top-level `secrets:` and in the `api` service's `secrets:` list — or the process never sees it.
- **R8** The Drizzle column type `encryptedText(table, column)` applies R2 on write and R4 on read with that column's AAD, so business code never handles ciphertext.
- **R9** The PII module is configured once at process start (`configurePii`). Using `getPii()` before configuration throws `PiiError`.
- **R10** Random bytes come from `node:crypto` `randomBytes` (RFC-02 R13).
- **R11** Encrypted columns never appear in `WHERE`, `ORDER BY`, `GROUP BY` or `UNIQUE` constraints: the random IV makes every ciphertext unique, so `eq(users.email, x)` encrypts `x` afresh and matches nothing. Equality lookups go through the blind-index column (R5), which is the only indexed form of a PII value.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-12 — R7: Compose declaration of a new key version added.
- 2026-09-12 — R2, R8: ciphertexts bound to their column with AAD; R11: no querying on encrypted columns (issue #7).
- 2026-09-12 — R1: users columns and Redis records (RFC-20, RFC-22, RFC-23).
