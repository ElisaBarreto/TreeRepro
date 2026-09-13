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
**Fix:** For each image run `docker buildx imagetools inspect <image:tag> --format '{{json .Manifest.Digest}}'` and replace the `@sha256:…` suffix on every `FROM` in `infra/docker/*.Dockerfile`, every `image:` in `compose*.yml` (node, postgres, redis, caddy, mailpit) and the two testcontainers images in `apps/api/test/global-setup.ts` (postgres, redis). Keep the tag next to the digest so the version stays readable. The CI image builds fail on a stale digest.

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
**Fix:** Create and `chown` the directory in the Dockerfile before `USER`, and declare it with `VOLUME` (`infra/docker/backup.Dockerfile` does this for `/backups`, `infra/docker/web.Dockerfile` for `/data` and `/config`; the `postgres` and `redis` images already own `/var/lib/postgresql` and `/data`). The backup entrypoint also exits non-zero when `backup.sh` fails and `compose.prod.yml` restarts it with `on-failure`, so a broken backup shows up in `docker compose ps` instead of being retried silently the next day.

## Caddy binds 80/443 without root
**Symptom:** Caddy answers `listen tcp :80: bind: permission denied` after a change to `infra/docker/web.Dockerfile` or to the `caddy` service in `compose.prod.yml`.
**Cause:** The `web` image runs as `caddy` (uid/gid 1000, RFC-02 R10). Binding a privileged port then depends on two things together: the `cap_net_bind_service=ep` file capability the upstream `caddy:alpine` image ships on `/usr/bin/caddy` (`getcap /usr/bin/caddy`), and `cap_add: [NET_BIND_SERVICE]` in `compose.prod.yml`, which keeps the capability in the container's bounding set. `no-new-privileges` does not interfere: Docker grants the added capability to the process before `exec`, so the file capability re-acquires it rather than adding a new one. Replacing the binary (a `COPY --from` of a custom build) drops the file capability; dropping the `cap_add` empties the bounding set.
**Fix:** Keep both. After changing either, run the image with the production options and check `grep CapEff /proc/1/status` inside prints `0000000000000400` and `curl -I http://localhost` answers.

## A deployment that ran the root-based `web` image has root-owned Caddy volumes
**Symptom:** After updating `treerepro-web` on a host that already ran the image before issue #31, Caddy logs `permission denied` under `/data/caddy` or on `/config/caddy/autosave.json`, or asks Let's Encrypt for certificates it already held.
**Cause:** A fresh named volume copies the image ownership (`caddy:caddy`), but `caddy-data` and `caddy-config` created by the root-based image hold root-owned `0600`/`0700` files: ACME account keys, certificates, `autosave.json`.
**Fix:** One-off: `docker compose stop caddy`, then `docker run --rm -v treerepro_caddy-data:/data -v treerepro_caddy-config:/config alpine chown -R 1000:1000 /data /config`, then `docker compose up -d caddy`. `docker compose run --user root caddy chown …` does not work: the service drops every capability, including `CAP_CHOWN`.

## Secret files must be readable by the container user on Linux
**Symptom:** On a Linux host the `api`, `redis`, `backup` containers or the Postgres init script fail with `EACCES` (or `Permission denied`) reading `/run/secrets/*`, although the same stack works on Docker Desktop.
**Cause:** Compose file secrets are bind mounts of the host files with their host owner and mode. `scripts/gen-secrets.sh` writes 0600 files owned by whoever ran it, while the services run as uid 1000 (`node`), 999 (`redis`) or 70 (`postgres`); Docker Desktop's file sharing masks ownership, a native Linux daemon does not.
**Fix:** Before the first Linux deployment make the files readable by the container users, for example `chmod 0440` with a group those uids share (or 0444 if the host directory itself is locked down), or use the service-level secret `mode`/`uid`/`gid` fields if the installed Compose honours them for file secrets. Verify on the target host with `docker compose exec api cat /run/secrets/session_secret >/dev/null`.

## Secure cookies work on http://localhost but not on a LAN address
**Symptom:** Login answers 200 but the browser drops `__Host-session`; every next request is 401.
**Cause:** `__Host-` cookies require `Secure`, and browsers accept `Secure` cookies only from secure contexts: `https://…` or `http://localhost`. `http://192.168.x.y` is not one.
**Fix:** Open the dev stack through `http://localhost` (Caddy on :80) or serve TLS. Do not weaken the cookie (RFC-22 R5).

## `docker compose cp` into a tmpfs mount silently does nothing
**Symptom:** `docker compose cp ./records.csv api:/tmp/records.csv` exits 0, but the file is not there — `docker compose exec api ls /tmp` never shows it, and a later `import:records --file /tmp/records.csv` fails with `ENOENT`.
**Cause:** `api`'s `/tmp` is a `tmpfs` mount (`read_only: true`, `tmpfs: [/tmp]`, RFC-02 R11). `docker compose cp` writes through the container's *image* filesystem layer via the Docker API, not through a live process inside the container; on a path that is actually a separate `tmpfs` mount, the copy either errors or (depending on the Compose/Docker version) reports success while writing nowhere the running container can see.
**Fix:** Stream the file into the container through a live process instead, which writes directly into the mounted tmpfs: `docker compose exec -T api sh -c 'cat > /tmp/sample_data.csv' < ./docs/exemplos/sample_data.csv` (small files only — the tmpfs is memory-backed and finite). For anything larger, or in production, bind-mount the host directory that holds the file read-only and point the CLI at that path instead of copying into the container at all (`docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-records.js --file /imports/sample_data.csv`).

## Never expose the API port directly
**Symptom:** Per-IP rate limits can be dodged and audit IPs are wrong.
**Cause:** The API trusts the last `X-Forwarded-For` entry (RFC-22 R12) because Caddy sanitizes it, so a client that reaches the API without Caddy chooses its own IP.
**Fix:** Only Caddy publishes ports in production; in development the API port is bound to loopback (`127.0.0.1:3000:3000` in `compose.dev.yml`).
