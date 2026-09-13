# Host, backups, restore, disk encryption

## The data on the VPS disk is not encrypted by `age`
**Symptom:** A provider snapshot, a decommissioned disk or a copied VM image exposes the Postgres cluster, the Redis append-only file and `infra/secrets/` in clear.
**Cause:** `age` protects only the dumps in the `backups` volume (design spec section 7). Docker volumes live in plaintext under `/var/lib/docker`, and the secret files next to the checkout.
**Fix:** Disk encryption is an infrastructure responsibility. Either use the provider's full-disk encryption when it offers it, or put Docker's data root and the checkout on a LUKS volume: `cryptsetup luksFormat /dev/<data-disk>`, `cryptsetup open /dev/<data-disk> data`, `mkfs.ext4 /dev/mapper/data`, mount it (for example at `/srv`) through `/etc/crypttab` and `/etc/fstab`, stop Docker, move `/var/lib/docker` there and point `data-root` in `/etc/docker/daemon.json` at the new path, then clone the repository under the same mount. Unlock manually through the provider console after a reboot; a keyfile stored on the same host defeats the purpose. Whatever the mechanism, the `age` identity (private key) and a copy of `infra/secrets/` stay off the server: without `pii_encryption_key_v1` a restored `users` table is unreadable (RFC-40).

## Restoring a backup
**Symptom:** The database must be rebuilt from a dump, or the backups must be proven restorable (the drill).
**Cause:** Dumps are `age`-encrypted plain SQL taken by the read-only `treerepro_backup` role with `--no-owner --no-privileges`, so they carry no `ALTER OWNER`/`GRANT` statements and restore as whichever role runs `psql`. The roles themselves are not in the dump; `infra/postgres/init/01-roles.sh` recreates them on an empty data volume from the current secret files.
**Fix:** Verified sequence (Postgres 18.6, `psql --single-transaction`):
1. Copy the newest dump out of the volume: `docker compose cp backup:/backups/treerepro-<stamp>.sql.age .` (works while the container sleeps between runs).
2. Decrypt on the machine that holds the `age` identity: `age -d -i key.txt treerepro-<stamp>.sql.age > dump.sql`.
3. Start from an empty cluster: `docker compose down`, `docker volume rm treerepro_postgres-data`, `docker compose up -d postgres` (the init script creates `treerepro_migrator`, `treerepro_app`, `treerepro_backup`).
4. Restore as the migrator so it owns every table and the app role's default privileges apply: `docker compose exec -T -e PGPASSWORD="$(cat infra/secrets/db_migrator_password)" postgres psql -U treerepro_migrator -d treerepro -v ON_ERROR_STOP=1 --single-transaction -q < dump.sql`.
5. `docker compose up -d`: `migrate` finds the restored migration journal and applies only what is newer; `api` starts once it succeeds.
6. Check: `docker compose ps` shows every service healthy, `docker compose exec postgres psql -U postgres -d treerepro -c 'select count(*) from users'` matches the expectation, a sign-in works (Redis is not backed up — sessions and rate-limit counters start empty, every user signs in again).

Drill: run steps 2–6 on a laptop against the dev stack (the same compose files, a throwaway `docker compose down -v` afterwards) after the first production deployment and whenever `backup.sh`, the Postgres image or the roles change. A drill that was never run is not a backup.

## Knowing that a backup failed
**Symptom:** The newest file in the `backups` volume is days old and nobody noticed.
**Cause:** `backup` exits 1 when `backup.sh` fails and `restart: on-failure` retries it with back-off, so `docker compose ps` shows `Restarting`, but nothing pushes that state anywhere.
**Fix:** Set `BACKUP_PING_URL` in `.env` to a dead man's switch URL (healthchecks.io, an Uptime Kuma push monitor, or anything that alerts when a periodic HTTP hit stops arriving, expected every 24 h). `backup.sh` fetches it only after a dump was written and encrypted; a failed fetch is logged and does not fail the backup. Leave it empty to disable. Also keep the drill above on the calendar: a ping proves the job ran, not that the file restores.
