# RFC-14 — Platforms

| Field | Value |
|---|---|
| Status | draft |
| Category | platform |
| Supersedes | — |

## Context

Design: `docs/specs/2026-11-11-plantrepro.md` §1, §8, §9 (epic #404, plan 15b, issue #396). One codebase, one API, one SPA build and one database serve two sites: TreeRepro, for tree species, and PlantRepro, for every plant. The request's `Host` decides which site a request belongs to. This RFC fixes how the platform of a request is resolved and how sessions and API keys relate to it. Roles per platform (15c), the plant-type scope (15d, 15e), maps (15f) and branding (15g) amend it as they land.

## Rules

- **R1** There are two platforms, keyed `treerepro` and `plantrepro`, displayed as `TreeRepro` and `PlantRepro` (`PLATFORMS`, `PLATFORM_NAMES` in `packages/contracts/src/platform.ts`).
- **R2** **Every feature, rule and screen applies to both platforms.** No route, rule, page or fix exists on only one of them. What differs between the two is scope (which species a platform shows, later RFCs) and presentation (name, emblem, colours), never behaviour.
- **R3** The platform of a request is resolved once, before the origin check (RFC-02 R3) and the session (RFC-22 R7), from the host of the request URL — the `Host` header Caddy forwards — with any port removed and compared ignoring case. The TreeRepro host is the host of `APP_ORIGIN`; the PlantRepro host is `PLANT_DOMAIN` (RFC-10 R5). A matching host puts the platform on the request context (`c.var.platform`). Any other host answers 421 `UNKNOWN_HOST` before anything else runs. When `PLANT_DOMAIN` is unset or empty, PlantRepro has no host, so every request meant for it answers 421 and TreeRepro serves as before. `GET /api/health` and `GET /api/health/ready` are exempt: they answer whatever the host (carrying the platform when the host has one, so a browser's session is untouched), since the Compose healthcheck calls `http://127.0.0.1:3000/api/health`.
- **R4** Each platform has its own origin, `originOf(platform)` (`apps/api/src/config.ts`): TreeRepro's is `APP_ORIGIN`; PlantRepro's has the scheme and port of `APP_ORIGIN` and the host `PLANT_DOMAIN` (in development `http://plantrepro.localhost`, in the end-to-end stack `http://plantrepro.localhost:8080`). Links built for a request — the invitation link, the password-reset link and their e-mail assets — use the origin of the request's platform. Mail sent with no request behind it names its platform explicitly: `seed:admin --platform` (RFC-20 R8), and the digest, which today runs for TreeRepro (RFC-74 R4). An invitation's links use the origin of the platform it names (RFC-20 R4), which may differ from the request's.
- **R5** A session belongs to the platform it was created on (RFC-22 R4). It authenticates only requests of that platform; presented on the other one, it is not resolved and the request continues unauthenticated. One account signs in separately on each site with the same credentials. The session list (RFC-22 R11), sign out everywhere (RFC-22 R9) and every revocation act on the account's sessions of both platforms.
- **R6** An API key is not bound to a platform: it authenticates on either host, and the request acts on the platform of the host it is sent to (RFC-82 R1). A `POST /api/batch` runs its operations on the platform of the batch's own host (RFC-82 R11).
- **R7** Hosts. Production: `treerepro.elisabarreto.com.br` (`DOMAIN`) and `plantrepro.elisabarreto.com.br` (`PLANT_DOMAIN`), served by one Caddy site block, one API process and one database. Development and end-to-end: `localhost` and `plantrepro.localhost`, which browsers resolve to loopback.
- **R8** Roles are assigned per platform and `admin` holds both (RFC-31 R16); permissions are resolved per platform (RFC-32 R1); a user with no role on a platform cannot sign in there (RFC-22 R13). People management acts on every account whatever its platforms (RFC-32 R9).
- **R9** Every species has a plant type, `tree` or `not_tree`, and a status, `proposed` or `reviewed` (RFC-60 R1). TreeRepro registers only trees: a species created, proposed or approved there is `tree`, while on PlantRepro the person registering it states the type (RFC-65 R18, RFC-75 R2, R4). This is scope, not an exclusive feature: the same form and route serve both, and the platform fixes the value. Which species each platform shows follows from the type (plan 15e).

## Open questions

None.

## Changelog

- 2026-11-11 — created: platforms, host resolution, per-platform origin, sessions and keys (plan 15b, issue #396).
- 2026-11-11 — R4 amended, R8 added: roles per platform, explicit platform for mail without a request (RFC-14, plan 15c, issue #397).
- 2026-11-11 — R9 added: the plant type, and TreeRepro registering only trees (plan 15d, issue #398).
