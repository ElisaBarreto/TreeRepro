# Plan 15b — Platform foundation: host, session, keys, two-host stack

**Spec:** `docs/specs/2026-11-11-plantrepro.md` §1, §8, §9. **Epic plan:** `docs/plans/2026-11-11-plantrepro.md` (pinned interfaces).

**After merge, TreeRepro users see nothing new.** Requests to `localhost` and to the TreeRepro host behave exactly as today.

## Tasks

1. **RFC and handbook.**
   - New `docs/rfc/10-platform/14-platforms.md`. Its rules cover:
     - the two platforms and their keys
     - resolving the platform from the host (port stripped, health routes exempt, an unknown host refused with 421 `UNKNOWN_HOST`, and PlantRepro refused when `PLANT_DOMAIN` is unset)
     - a session bound to its platform
     - an API key acting on the host it is sent to
     - **“every feature, rule and screen applies to both platforms”**
   - Amend RFC-10 (architecture: two hosts, one stack) and RFC-22 (session platform).
   - `CLAUDE.md`: add the platform line to the Layout section, and the rule under Non-negotiable rules.
2. **Contracts.** Create `packages/contracts/src/platform.ts` with `PLATFORMS`, `Platform` and `PLATFORM_NAMES`, and export it.
3. **Config.** `apps/api/src/config.ts` gains `plantDomain: string | null`, read from `PLANT_DOMAIN` (optional, empty means null). It also gains `originOf(platform)`, which replaces the single `APP_ORIGIN` where mail links are built. In development, the PlantRepro origin is `http://plantrepro.localhost:<port>`.
4. **Host resolution.** Write `apps/api/src/http/platform.ts`.
   - Tests come first, as a unit test:
     - `localhost:8080` gives `treerepro`
     - `plantrepro.localhost:8080` gives `plantrepro`
     - the TreeRepro production host gives `treerepro`
     - the PlantRepro host with a null `plant` domain gives `null`
     - an unknown host gives `null`
     - matching ignores case
   - The middleware is mounted before the session middleware. It sets `c.var.platform`, answers 421 for `null`, and skips `/api/health*`.
   - Add an integration test that the Compose healthcheck's `127.0.0.1:3000` still answers.
5. **Session.** `SessionRecord` gains `platform`, written on creation from `c.var.platform`.
   - A record with no field reads as `treerepro`. Test it by inserting a hash without the field, which must still authenticate on TreeRepro.
   - A session presented with a different `c.var.platform` is refused as unauthenticated.
6. **API keys and batch.**
   - A key authenticates on either host, and `c.var.platform` comes from the host. Permissions are still unscoped until 15c.
   - In `apps/api/src/http/routes/batch.ts`, the internal `Request` keeps the incoming `Host`. Test: a batch sent to `plantrepro.localhost` dispatches operations that see `platform = 'plantrepro'`.
   - Rule 10: update the guide (second host), the changelog, the route catalog if it changed, and the openapi hash.
7. **Caddy and Compose.**
   - `infra/docker/Caddyfile.prod`: the site address becomes `{$DOMAIN}, {$PLANT_DOMAIN}`. Check with `caddy validate` that it parses with `PLANT_DOMAIN` empty. If it does not, use a dedicated block guarded by a default such as `{$PLANT_DOMAIN:plantrepro.invalid}`.
   - In the dev Caddyfile, compose and `compose.e2e.yml`, serve `plantrepro.localhost` as well.
   - `.env.example` documents `PLANT_DOMAIN`.
8. **E2E smoke.** Add a Playwright spec that loads `/` on `http://localhost:8080` and on `http://plantrepro.localhost:8080`, and signs in on both with the seeded admin. Chromium resolves `*.localhost` to loopback.

**Verify:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm rfc:check`, `pnpm test:e2e`.
