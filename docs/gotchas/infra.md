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

## A `cachedJson` value is plaintext at rest in Redis
**Symptom:** Nothing at the call site says so, but whatever is passed to `cachedJson` (`apps/api/src/redis/cache.ts`) is stored as plain JSON — readable in `MONITOR`, in the RDB/AOF file, in any Redis backup.
**Cause:** `cachedJson` never goes through the PII module; only Postgres columns wrapped in `encryptedText` are encrypted, and RFC-40 R1 says Redis is bound by that same rule, not exempt from it. The cases that bite are indirect: a record item's `createdBy: { id, name }` and a reference's `observer` both carry `users.name`, an `encryptedText` column, so caching either one caches a colleague's real name without the caching code ever naming a user.
**Fix:** Cache identifiers, not the object carrying the PII, and re-hydrate from Postgres outside the cached entry — what plan 11b's `dashboard:<viewer id>` entry landed on: it stores the ids of the records awaiting validation and looks up `createdBy.name` fresh on every request instead of caching the record items. Encrypting the cached blob is the heavier alternative for when the value can't be reduced to ids.

## Deploying to production
**Symptom:** A merge to `main` did not reach the server, or the server must be set up again from scratch.
**Cause:** The `Deploy` job in `.github/workflows/ci.yml` runs after `Verify`, `Images` and `E2E` pass on a push to `main`. It connects as `deploy` with a key whose `authorized_keys` line forces `scripts/deploy.sh`, so the key can do nothing but redeploy a commit already on `main`; the script checks out that SHA, rebuilds the images on the server and runs `docker compose up -d --wait`. The job reads three secrets of the `production` environment: `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`) and `DEPLOY_SSH_KEY` (the private key).
**Fix:** Server from scratch (Ubuntu 24.04, as root): key-only SSH (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`), `ufw` allowing 22, 80, 443/tcp and 443/udp, `fail2ban`, `unattended-upgrades`, a swap file (the image builds need it on a small VPS), Docker with the Compose plugin, a `deploy` user in the `docker` group. As `deploy`: clone the repository to `/srv/treerepro`, `./scripts/gen-secrets.sh`, write the production `.env` (`.env.example`), then add the CI key to `~deploy/.ssh/authorized_keys` as `command="/srv/treerepro/scripts/deploy.sh",restrict ssh-ed25519 AAAA…`. A manual redeploy is `ssh deploy@<host> <sha>` with that key, or `scripts/deploy.sh <sha>` on the server. Keep a copy of `infra/secrets/` off the server (see above).

## Production mail lands in spam
**Symptom:** Invitations and password resets reach Gmail with `SPF`, `DKIM` and `DMARC` all `pass`, yet land in spam.
**Cause:** Mail sent straight from the VPS carries a new domain and a new IP with no sending history, and VPS address ranges have a poor reputation; authentication alone does not earn inbox placement. Direct sending from the server was tried at the first deployment and landed in spam.
**Fix:** Send through a transactional provider (Brevo at the time of writing). In the provider: authenticate the domain (its `brevo-code` TXT, the DKIM CNAMEs and a DMARC record, all DNS-only), add the sender (`SMTP_FROM`), create an SMTP key and add the server IP to the authorized IPs (otherwise login answers `525 5.7.1 Unauthorized IP address`). On the server: `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_SECURE=false` (STARTTLS) and `SMTP_USER` in `.env`, the SMTP key in `infra/secrets/smtp_password` (mode 0444, see above), then `docker compose up -d api`.
