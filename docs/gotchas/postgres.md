# PostgreSQL

## The `postgres:18` image moved the data directory
**Symptom:** Data disappears between restarts, or `initdb` complains the directory is not empty.
**Cause:** From 18 the image stores data at `/var/lib/postgresql/18/docker` and expects the volume at `/var/lib/postgresql`, not `/var/lib/postgresql/data`.
**Fix:** `compose.yml` mounts `postgres-data:/var/lib/postgresql`. Never mount `/var/lib/postgresql/data`.

## Init scripts run once
**Symptom:** New passwords in `infra/secrets/` are ignored; `treerepro_app` cannot log in.
**Cause:** `/docker-entrypoint-initdb.d` runs only when the data volume is empty.
**Fix:** Development: `docker compose down -v` (destroys data), then `up`. Production: `ALTER ROLE … PASSWORD` manually, then update the secret file.

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
