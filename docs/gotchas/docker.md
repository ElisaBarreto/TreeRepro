# Docker, Compose, Caddy

## No CSP in development
**Symptom:** The production CSP would block the app in dev.
**Cause:** Vite and React Fast Refresh inject inline scripts in dev.
**Fix:** `Caddyfile.dev` sets no CSP; `Caddyfile.prod` sets the strict one (RFC-02 R5). The production build is verified to contain no inline script (the web build check `grep -c '<script' apps/web/dist/index.html` prints 1, with a `src` attribute).

## `/api/health/ready` is 404 through Caddy on purpose
**Symptom:** `curl http://localhost/api/health/ready` answers 404 while `/api/health` answers 200 and the API logs show no request.
**Cause:** RFC-10 R10 — readiness reveals dependency state and is for the internal network only; both Caddyfiles answer it with `respond @ready 404` before the proxy.
**Fix:** Query it from inside the network: `docker compose exec api wget -qO- http://127.0.0.1:3000/api/health/ready`.

## HMR behind Caddy
**Symptom:** Page loads but edits do not hot-reload; console shows a failed WebSocket to port 5173.
**Cause:** The browser reaches Vite through Caddy on port 80.
**Fix:** `compose.dev.yml` sets `VITE_HMR_CLIENT_PORT=80`, which `vite.config.ts` turns into `server.hmr.clientPort`.

## `!reset` in `compose.dev.yml`
**Symptom:** `docker compose up` in development builds the production API image (`infra/docker/api.Dockerfile`) for `migrate` instead of using `treerepro-dev`.
**Cause:** The base `migrate` service builds the production image; in dev it must use `treerepro-dev` instead, and Compose merges maps, so `build` has to be removed explicitly.
**Fix:** `build: !reset null`. Requires Compose v2.24 or newer.

## Base images are pinned by tag and digest
**Symptom:** A build or `docker compose pull` fails with `manifest ... not found` or a digest mismatch after a base image was bumped, or a `FROM`/`image:` line lacks `@sha256:…`.
**Cause:** RFC-02 R11 pins every base image by tag *and* digest (`postgres:18.6-alpine@sha256:…`); the digest is the multi-arch index digest and changes with every rebuild of the upstream tag, so a version bump must refresh it.
**Fix:** For each image run `docker buildx imagetools inspect <image:tag> --format '{{json .Manifest.Digest}}'` and replace the `@sha256:…` suffix on every `FROM` in `infra/docker/*.Dockerfile` and every `image:` in `compose*.yml` (node, postgres, redis, caddy, mailpit). Keep the tag next to the digest so the version stays readable. The CI image builds fail on a stale digest.

## Caddy reorders directives
**Symptom:** `/api/health/ready` returned 200 through Caddy although `respond @ready 404` was written first.
**Cause:** Caddy does not run directives in file order; it sorts them by its built-in directive order (`handle` runs before `respond`), so a later `handle` swallowed the request before the earlier `respond` could match.
**Fix:** Both `infra/docker/Caddyfile.dev` and `infra/docker/Caddyfile.prod` wrap the directives in a `route { }` block, which disables the automatic sort and preserves the written order.

## Redis password lives in a tmpfs config file
**Symptom:** `ps` inside the container shows no password.
**Cause:** `--requirepass` on argv is visible via `/proc`.
**Fix:** the compose command writes `/tmp/redis.conf` on a tmpfs and `redis-cli` authenticates through `REDISCLI_AUTH`. Because the service runs as `user: redis` (RFC-02 R10), the image entrypoint sets `umask 0077` and the file is mode 0600.

## Named volumes mounted into non-root containers are root-owned unless the image pre-creates the directory
**Symptom:** A service that runs as a non-root user (`USER postgres`, `user: redis`) cannot write to its named volume: `Permission denied` on the mount path, e.g. the backup job failing on `age --output /backups/...`.
**Cause:** When Compose mounts a fresh named volume at a path that does not exist in the image, Docker creates the mount point as `root:root 0755`. A volume only inherits ownership from a directory that already exists in the image.
**Fix:** Create and `chown` the directory in the Dockerfile before `USER`, and declare it with `VOLUME` (`infra/docker/backup.Dockerfile` does this for `/backups`; the `postgres` and `redis` images already own `/var/lib/postgresql` and `/data`). The backup entrypoint also exits non-zero when `backup.sh` fails and `compose.prod.yml` restarts it with `on-failure`, so a broken backup shows up in `docker compose ps` instead of being retried silently the next day.

## Secret files must be readable by the container user on Linux
**Symptom:** On a Linux host the `api`, `redis`, `backup` containers or the Postgres init script fail with `EACCES` (or `Permission denied`) reading `/run/secrets/*`, although the same stack works on Docker Desktop.
**Cause:** Compose file secrets are bind mounts of the host files with their host owner and mode. `scripts/gen-secrets.sh` writes 0600 files owned by whoever ran it, while the services run as uid 1000 (`node`), 999 (`redis`) or 70 (`postgres`); Docker Desktop's file sharing masks ownership, a native Linux daemon does not.
**Fix:** Before the first Linux deployment make the files readable by the container users, for example `chmod 0440` with a group those uids share (or 0444 if the host directory itself is locked down), or use the service-level secret `mode`/`uid`/`gid` fields if the installed Compose honours them for file secrets. Verify on the target host with `docker compose exec api cat /run/secrets/session_secret >/dev/null`.
