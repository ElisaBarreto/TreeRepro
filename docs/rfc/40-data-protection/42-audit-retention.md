# RFC-42 — Audit retention

| Field | Value |
|---|---|
| Status | accepted |
| Category | data-protection |
| Supersedes | — |

## Context

The audit log (RFC-41) is append-only and the runtime role must not be able to delete from it, yet entries older than the retention period must go (data minimization, GDPR Art. 5(1)(e)). Deletion therefore happens inside a privileged database function that the application can only execute, on a schedule owned by the API process.

## Rules

- **R1** Retention is 2 years, measured on `audit_log.at`. Entries younger than that are never deleted by any path.
- **R2** Function `audit_log_purge()` (`RETURNS bigint`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp` — `pg_temp` named explicitly and **last**: unless it is listed, PostgreSQL searches the temporary schema *before* every listed schema for relation names, so a caller holding `TEMPORARY`, which `treerepro_app` does through the default `PUBLIC` grant, could shadow `audit_log` with a temporary table and have the definer body act on it as the owner), owned by `treerepro_migrator`: sets `treerepro.allow_audit_purge = 'on'` for the current transaction with `set_config(…, true)`, deletes rows where `at < now() - interval '2 years'`, and returns the number of rows deleted. The retention period is hard-coded in the function; it takes no parameter, so no caller can purge younger entries.
- **R3** Privileges: `EXECUTE` on `audit_log_purge()` is revoked from `PUBLIC` and granted to `treerepro_app`; `DELETE` on `audit_log` is revoked from `treerepro_app` (with `UPDATE`, RFC-41 R9). The app role therefore holds `SELECT` and `INSERT` only; the trigger of RFC-41 R2 remains the second line of defense.
- **R4** The API process runs `SELECT audit_log_purge()` once at start-up, after the HTTP server listens, and every 24 hours thereafter (`startRetentionTimer`); the timer never keeps the process alive (`unref`). Each run logs the count at `info`; a failed run logs at `error` and the process continues. `createApp` does not start the timer, so tests never purge. `purgeAudit` records a `job_runs` row of kind `audit_purge` with `detail.purged` (RFC-74 R1).
- **R5** Nothing else deletes from `audit_log`. A migration that must remove entries calls `audit_log_purge()` or is reviewed under RFC-00.
- **R6** `job_runs_purge()` deletes runs older than one year, called by the retention timer after the audit purge, `SECURITY DEFINER` with pinned `search_path` (`RETURNS bigint`, `SET search_path = public, pg_temp`, `pg_temp` named explicitly and last as in R2), owned by `treerepro_migrator`. `EXECUTE` is revoked from `PUBLIC` and granted to `treerepro_app`; the app role otherwise holds `SELECT`, `INSERT` and `UPDATE` on `job_runs` and neither `DELETE` nor `TRUNCATE` (RFC-74 R7).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-18 — R2: the pinned `search_path` names `pg_temp` explicitly and last (`public, pg_temp`), as RFC-69 R3 already does. Correction, not a design change: migration 0007 wrote `SET search_path = public`, which left the temporary schema searched first; migration 0023 re-creates the function with the corrected clause (issue #93).
- 2026-09-19 — R4 amended: `purgeAudit` also records its run in `job_runs`; R6 added: `job_runs_purge()` purges `job_runs` on the same schedule, right after the audit purge (RFC-74, plan 12b).
