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

## Purging the audit log
**Symptom:** `audit_log is append-only` when deleting.
**Cause:** RFC-41 R2 trigger.
**Fix:** Only the retention job may delete, inside a transaction, after `SET LOCAL treerepro.allow_audit_purge = 'on'`. `SET` without `LOCAL` is refused by the trigger design (the setting must not outlive the transaction).
