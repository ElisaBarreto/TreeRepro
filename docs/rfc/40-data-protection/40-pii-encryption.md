# RFC-40 — PII encryption

| Field | Value |
|---|---|
| Status | draft |
| Category | data-protection |
| Supersedes | — |

## Context

Personal data of system users (name, email, IP address, user agent) must be unreadable in database dumps, backups and disk images. Encryption happens in the API process; the database never sees keys or plaintext.

## Rules

- **R1** PII columns are stored encrypted; plaintext is never persisted. Columns: `users.name`, `users.email` (both defined with RFC-2x), `audit_log.ip`, `audit_log.user_agent` (RFC-41).
- **R2** Algorithm: AES-256-GCM with a fresh 12-byte random IV per encryption and a 16-byte authentication tag. Stored format: `v<version>:<iv>:<tag>:<ciphertext>`, each part base64url without padding.
- **R3** Keys are 32 bytes. Each key version is a secret file `pii_encryption_key_v<N>` containing 64 lowercase hex characters. The keyring maps version label (`v1`, `v2`, …) to key; the version named by `PII_CURRENT_KEY_VERSION` (default `v1`) encrypts; every version in the keyring can decrypt.
- **R4** Decrypting a malformed value, an unknown version, or a value whose authentication fails throws `PiiDecryptError`. No partial plaintext is ever returned.
- **R5** Blind index for equality lookups: `HMAC-SHA256(pii_hmac_key, normalize(value))` as lowercase hex, where `normalize` = Unicode NFKC → trim → lowercase. The HMAC key is a separate 32-byte secret `pii_hmac_key`.
- **R6** Keys never appear in logs, database rows, API responses or error messages.
- **R7** Rotation: add `pii_encryption_key_v<N+1>`, set `PII_CURRENT_KEY_VERSION=v<N+1>`, restart; re-encrypt rows in batches (each row read via the keyring and written with the current key); remove the old secret only after `SELECT count(*) … WHERE col LIKE 'v<N>:%'` is zero for every PII column.
- **R8** The Drizzle column type `encryptedText` applies R2 on write and R4 on read, so business code never handles ciphertext.
- **R9** The PII module is configured once at process start (`configurePii`). Using `getPii()` before configuration throws `PiiError`.
- **R10** Random bytes come from `node:crypto` `randomBytes` (RFC-02 R13).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
