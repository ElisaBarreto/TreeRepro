# RFC-42 — Audit retention

| Field | Value |
|---|---|
| Status | draft |
| Category | data-protection |
| Supersedes | — |

## Context

The audit log (RFC-41) is append-only and the runtime role must not be able to delete from it, yet entries older than the retention period must go (data minimization, GDPR Art. 5(1)(e)). Deletion therefore happens inside a privileged database function that the application can only execute, on a schedule owned by the API process.

## Rules

- **R1** Retention is 2 years, measured on `audit_log.at`. Entries younger than that are never deleted by any path.
- **R2** Function `audit_log_purge()` (`RETURNS bigint`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`), owned by `treerepro_migrator`: sets `treerepro.allow_audit_purge = 'on'` for the current transaction with `set_config(…, true)`, deletes rows where `at < now() - interval '2 years'`, and returns the number of rows deleted. The retention period is hard-coded in the function; it takes no parameter, so no caller can purge younger entries.
- **R3** Privileges: `EXECUTE` on `audit_log_purge()` is revoked from `PUBLIC` and granted to `treerepro_app`; `DELETE` on `audit_log` is revoked from `treerepro_app` (with `UPDATE`, RFC-41 R9). The app role therefore holds `SELECT` and `INSERT` only; the trigger of RFC-41 R2 remains the second line of defense.
- **R4** The API process runs `SELECT audit_log_purge()` once at start-up, after the HTTP server listens, and every 24 hours thereafter (`startRetentionTimer`); the timer never keeps the process alive (`unref`). Each run logs the count at `info`; a failed run logs at `error` and the process continues. `createApp` does not start the timer, so tests never purge.
- **R5** Nothing else deletes from `audit_log`. A migration that must remove entries calls `audit_log_purge()` or is reviewed under RFC-00.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
