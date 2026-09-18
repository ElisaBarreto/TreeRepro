# PostgreSQL

## The `postgres:18` image moved the data directory
**Symptom:** Data disappears between restarts, or `initdb` complains the directory is not empty.
**Cause:** From 18 the image stores data at `/var/lib/postgresql/18/docker` and expects the volume at `/var/lib/postgresql`, not `/var/lib/postgresql/data`.
**Fix:** `compose.yml` mounts `postgres-data:/var/lib/postgresql`. Never mount `/var/lib/postgresql/data`.

## Init scripts run once
**Symptom:** New passwords in `infra/secrets/` are ignored; `treerepro_app` cannot log in. Or, on a volume created before the `backup` service got its own role, the backup container fails with `password authentication failed for user "treerepro_backup"`.
**Cause:** `/docker-entrypoint-initdb.d` runs only when the data volume is empty, so `infra/postgres/init/01-roles.sh` never re-runs: neither a changed password nor a role added later reaches an existing volume.
**Fix:** Development: `docker compose down -v` (destroys data), then `up`. Production: apply the change by hand as the superuser, with `\password` so the value never appears in the statement text (`docker compose exec postgres psql -U postgres -d treerepro`, then `\password treerepro_app` and type the value from the secret file). A missing backup role: `CREATE ROLE treerepro_backup LOGIN; GRANT pg_read_all_data TO treerepro_backup;` followed by `\password treerepro_backup`.

## Role passwords are set with `\password`, not `CREATE ROLE … PASSWORD`
**Symptom:** A reviewer expects `01-roles.sh` to pass the passwords as psql variables or `-c` arguments.
**Cause:** Anything in argv shows in `/proc` while psql runs, and `CREATE ROLE … PASSWORD :'var'` is expanded client-side, so the server still receives the plaintext and logs it with the statement on error (`log_min_error_statement`) or always (`log_statement = all`).
**Fix:** The script feeds `\password <role>` and the value twice through psql's stdin (the heredoc; the container has no controlling terminal, so the `/dev/tty` prompt falls back to stdin). psql computes the SCRAM-SHA-256 verifier itself and sends `ALTER USER … PASSWORD 'SCRAM-SHA-256$…'`, so the plaintext never reaches the server. Checked against `postgres:18.6-alpine` with `log_statement = all`: the log shows only verifiers.

## `uuidv7()` needs PostgreSQL 18
**Symptom:** `function uuidv7() does not exist`.
**Cause:** Built-in since 18.
**Fix:** Every environment, including testcontainers (`postgres:18.6-alpine`), runs 18.

## Expression unique index on `lower(name)`
**Symptom:** Drizzle's query builder cannot express "find a role by name ignoring case", and `roles.name` alone is not unique.
**Cause:** Uniqueness is enforced by the index `roles_name_lower_idx` on `lower(name)` (RFC-31 R1), not by a plain unique column.
**Fix:** Insert and let the unique violation (`23505`) surface through `isUniqueViolation`; for lookups use `sql\`lower(${roles.name}) = ${name.toLowerCase()}\``.

## Purging the audit log
**Symptom:** `audit_log is append-only` when deleting.
**Cause:** The RFC-41 R2 trigger lets a `DELETE` through only when `current_setting('treerepro.allow_audit_purge', true)` is `'on'`.
**Fix:** Only the retention job (RFC-42, future) may delete, inside a transaction, after `SET LOCAL treerepro.allow_audit_purge = 'on'`. The flag is a convention, not a protection: PostgreSQL cannot tell `SET LOCAL` from a session-level `SET`, and `treerepro_app` holds `DELETE` on `audit_log`, so any code running as the app role could set it and purge. `SET LOCAL` matters because it keeps the flag transaction-scoped; a plain `SET` on a pooled connection would leak into later requests. Code review enforces this until RFC-42 moves purging into a `SECURITY DEFINER` function and revokes `DELETE` from the app role.

## A `SECURITY DEFINER` function must pin `search_path`
**Symptom:** A privileged function (`audit_log_purge`) resolves a table or operator name through the caller's schema, letting a lower-privileged role hijack it.
**Cause:** `SECURITY DEFINER` runs as the owner but, by default, with the caller's `search_path`.
**Fix:** Declare `SET search_path = public, pg_temp` on the function and revoke `EXECUTE` from `PUBLIC` before granting it to the role that needs it. `pg_temp` must be named, and named **last**: unless it appears in `search_path`, PostgreSQL searches the temporary schema *first* for relation names, so a caller holding `TEMPORARY` (every role, through the default `PUBLIC` grant) could create `pg_temp.audit_log` and have the definer body act on it as the owner. Migration 0007 shipped `public` alone; 0023 corrected it (issue #93), and 0022 got it right from the start. `retention.integration.test.ts` asserts the clause on `audit_log_purge()`; `privileges.integration.test.ts` sweeps every `SECURITY DEFINER` function in `public` for a `search_path` ending in `pg_temp`, so the next one cannot ship without it.

## `REVOKE DELETE` is the guarantee; the trigger is the backup
**Symptom:** Setting `treerepro.allow_audit_purge = 'on'` in a session still cannot delete from `audit_log`.
**Cause:** Since migration 0007 the app role has no `DELETE` privilege; the trigger flag only matters inside `audit_log_purge()`, which runs as the table owner.
**Fix:** Nothing to fix — call `select audit_log_purge()`; there is no other supported path (RFC-42 R5).

## Migration 0022 backfills coverage over every record
**Symptom:** `db:migrate` (or the `migrate` service) sits on `0022_coverage.sql` for minutes with nothing on stdout, and the stack does not come up.
**Cause:** RFC-69 R3's backfill groups the whole of `trait_records` — eight million rows on the production dataset — into `species_trait_coverage`, then sets `species.trait_count` from it. The migrator has no statement timeout, so the two statements simply run to completion.
**Fix:** Nothing to fix — let it finish; do not interrupt the migrator. An interrupted run leaves 0022 unapplied and the next one repeats the whole scan from the start.

## Stop `api` before applying migration 0022 to a running stack
**Symptom:** After a rolling upgrade, a species reads "Missing data" for a trait it demonstrably has: it is absent from `?traitId=…&traitData=with`, present in `…&traitData=missing`, and `sort=completeness` ranks it as more incomplete than it is. Permanently — nothing recomputes, and re-running the migration does not repair it.
**Cause:** `compose.yml`'s `api` declares `depends_on: migrate: service_completed_successfully`, which orders a **cold** start only. On `docker compose up -d` against a stack that is already running, `migrate` starts while the previous `api` container keeps serving. Drizzle applies the migration in one transaction, so its `CREATE OR REPLACE` of `trait_records_reference_usage()` is invisible to those sessions: every `trait_records` insert they commit still executes the pre-0022 (0015) function, which knows nothing about coverage. Under READ COMMITTED the backfill `INSERT` takes its own snapshot, so rows committed after it are missed. The backfill runs for minutes on the 8M-row dataset (see above), so the window is minutes wide. The damage is silent — no error, no log line, only a species that has dropped out of a filter — and the backfill is not usable as a repair: `ON CONFLICT DO NOTHING` skips every pair that already exists, so a pair left with a short `record_count` stays short, and only an entirely fresh pair is ever recovered.
**Fix:** Stop the API for the upgrade; do not rely on compose ordering.

```
docker compose pull                # or build
docker compose stop api            # no writer while the backfill runs
docker compose up -d               # migrate runs to completion, then api starts
```

If it was not stopped, a repair has to **update** rather than skip on conflict — the aggregate below is over the whole of `trait_records`, so its values are the authoritative ones. Run it as `treerepro_migrator` (the app role has `SELECT` only on the table) with `api` stopped, then recompute the column:

```sql
insert into species_trait_coverage (species_id, trait_id, record_count, harmonised_count, first_record_at, last_record_at)
select species_id, trait_id, count(*), count(*) filter (where harmonisation = 'harmonised'), min(created_at), max(created_at)
from trait_records group by 1, 2
on conflict (species_id, trait_id) do update set
  record_count = excluded.record_count,
  harmonised_count = excluded.harmonised_count,
  first_record_at = excluded.first_record_at,
  last_record_at = excluded.last_record_at;

update species s set trait_count = c.n
from (select species_id, count(*) as n from species_trait_coverage group by 1) c
where s.id = c.species_id;
```
