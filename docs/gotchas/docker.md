# Docker, Compose, Caddy

## No CSP in development
**Symptom:** The production CSP would block the app in dev.
**Cause:** Vite and React Fast Refresh inject inline scripts in dev.
**Fix:** `Caddyfile.dev` sets no CSP; `Caddyfile.prod` sets the strict one (RFC-02 R5). The production build is verified to contain no inline script (the web build check `grep -c '<script' apps/web/dist/index.html` prints 1, with a `src` attribute).

## `/api/health/ready` is 404 through Caddy on purpose
**Cause:** RFC-10 R10 — readiness reveals dependency state and is for the internal network only.
**Fix:** Query it from inside the network: `docker compose exec api wget -qO- http://127.0.0.1:3000/api/health/ready`.

## HMR behind Caddy
**Symptom:** Page loads but edits do not hot-reload; console shows a failed WebSocket to port 5173.
**Cause:** The browser reaches Vite through Caddy on port 80.
**Fix:** `compose.dev.yml` sets `VITE_HMR_CLIENT_PORT=80`, which `vite.config.ts` turns into `server.hmr.clientPort`.

## `!reset` in `compose.dev.yml`
**Cause:** The base `migrate` service builds the production image; in dev it must use `treerepro-dev` instead, and Compose merges maps, so `build` has to be removed explicitly.
**Fix:** `build: !reset null`. Requires Compose v2.24 or newer.

## Base images are pinned by tag; pin by digest after the first build
**Cause:** RFC-02 R11.
**Fix:** `docker buildx imagetools inspect node:24.21.0-alpine` (and `postgres:18.6-alpine`, `redis:8.8-alpine`, `caddy:2.9.1-alpine`), then append `@sha256:…` to the `FROM`/`image:` lines. Refresh digests when bumping versions.

## Caddy reorders directives
**Symptom:** `/api/health/ready` returned 200 through Caddy although `respond @ready 404` was written first.
**Cause:** Caddy does not run directives in file order; it sorts them by its built-in directive order (`handle` runs before `respond`), so a later `handle` swallowed the request before the earlier `respond` could match.
**Fix:** Both `infra/docker/Caddyfile.dev` and `infra/docker/Caddyfile.prod` wrap the directives in a `route { }` block, which disables the automatic sort and preserves the written order.

## Redis password lives in a tmpfs config file
**Symptom:** `ps` inside the container shows no password.
**Cause:** `--requirepass` on argv is visible via `/proc`.
**Fix:** the compose command writes `/tmp/redis.conf` on a tmpfs and `redis-cli` authenticates through `REDISCLI_AUTH`.
