# PlantRepro (epic, plans 15a–15i) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each plan task by task.

**Goal:** Serve a second platform, PlantRepro, from the same codebase and the same database. PlantRepro shows every plant. TreeRepro keeps showing only reviewed trees, and roles are held per platform.

**Architecture:** The request's `Host` decides the platform. The platform is threaded into:

- the session
- permission resolution, through `user_roles.platform`
- `Visibility`, through a species plant-type condition

There is one SPA build. It reads `location.hostname` and sets `data-platform` for the brand. Nothing is exclusive to one platform.

**Tech Stack:** Hono 4, Drizzle and PostgreSQL 18, Redis 8, React 19, TanStack, Tailwind 4, Zod 4, Vitest 5 with testcontainers, Playwright, Caddy 2.

**Spec:** `docs/specs/2026-11-11-plantrepro.md`

## Plans (one issue each, all in milestone “PlantRepro”, sub-issues of the epic)

| Plan | File | Depends on | Migration | TreeRepro users see after merge |
|---|---|---|---|---|
| 15a Production gate | `2026-11-11-plantrepro-15a-production-gate.md` | none | no | nothing |
| 15b Platform foundation | `2026-11-11-plantrepro-15b-platform-foundation.md` | 15a | no (Redis only) | nothing |
| 15c Roles per platform | `2026-11-11-plantrepro-15c-roles-per-platform.md` | 15b | yes, gated | admins: a per-platform role section on the user page |
| 15d Plant type | `2026-11-11-plantrepro-15d-plant-type.md` | 15b | yes, gated | a Plant type column, filter and export columns, all showing `tree` |
| 15e Visibility per platform | `2026-11-11-plantrepro-15e-visibility.md` | 15c, 15d | no | managers: the Plant types queue (empty) |
| 15f Maps per platform | `2026-11-11-plantrepro-15f-maps.md` | 15e | yes, gated | nothing |
| 15g Branding | `2026-11-11-plantrepro-15g-branding.md` | 15b | no | nothing |
| 15h Go-live | `2026-11-11-plantrepro-15h-go-live.md` | 15c–15g | no | nothing |
| 15i Non-tree import | `2026-11-11-plantrepro-15i-non-tree-import.md` | 15h and the owner's data | maybe | nothing, since the new species are not trees |

Every merge to `main` auto-deploys to production. Each plan's PR must therefore be safe on its own, and the last column is a check its reviewer verifies. “Gated” means the 15a procedure runs on that branch, and the owner gives an explicit go before the merge.

15d and 15g may run in parallel with 15c.

## Global Constraints

- Platform keys: `treerepro` and `plantrepro`. Display names: `TreeRepro` and `PlantRepro`.
- Production hosts: `treerepro.elisabarreto.com.br` (`DOMAIN`) and `plantrepro.elisabarreto.com.br` (`PLANT_DOMAIN`).
- Development and E2E hosts: `localhost` for TreeRepro and `plantrepro.localhost` for PlantRepro. The port is ignored when the host is resolved.
- Plant types: `tree` and `not_tree`. Statuses: `proposed` and `reviewed`.
- TreeRepro scope: `plant_type = 'tree' AND plant_type_status = 'reviewed'`. PlantRepro scope: every species.
- `admin` is admin of both platforms, always. Every other role is assigned per platform.
- Existing data:
  - every `user_roles` row becomes `treerepro`
  - every species becomes `tree` / `reviewed`
  - every Redis session without a platform is `treerepro`
- No feature, rule or screen exists on only one platform. Plans 15b and 15g add this rule to `CLAUDE.md` and to the new platform RFC.
- Migration numbers are not fixed here. Use the next free number on `origin/main` at implementation time (`ls apps/api/drizzle` on `origin/main`).
- Rule 10: every plan that changes a route's behaviour or shape updates the route catalog, `docs/api/guide.md`, its changelog and the openapi hash in the same PR.
- Every UI change is checked on the running app by screenshots, and Rafael checks it before the PR (handbook practice).

## Cross-plan interfaces (pinned)

- `packages/contracts/src/platform.ts` (15b):
  - `PLATFORMS = ['treerepro', 'plantrepro'] as const`
  - `type Platform`
  - `PLATFORM_NAMES: Record<Platform, string>`
  - `PLANT_TYPES = ['tree', 'not_tree'] as const`, `type PlantType` (15d adds these here)
  - `PLANT_TYPE_STATUSES = ['proposed', 'reviewed'] as const`
- `apps/api/src/http/platform.ts` (15b):
  - `platformOfHost(host: string | undefined, domains: { tree: string; plant: string | null }): Platform | null`
  - middleware that sets `c.var.platform: Platform`
- `SessionRecord.platform: Platform` (15b). A Redis hash without the field reads as `'treerepro'`.
- `user_roles(user_id, role_id, platform)` (15c):
  - `platform` is `text not null` with a check over `PLATFORMS`
  - the primary key is `(user_id, role_id, platform)`
- `effectivePermissions(db, userId, platform)` and `resolvePermissions(…, platform)` (15c). The permission cache keys and generations include the platform.
- `species.plant_type` and `species.plant_type_status` (15d):
  - both `text not null`, with checks over the contracts lists
  - added with defaults `'tree'` / `'reviewed'` for the backfill, then the defaults are dropped in the same migration, so every insert must state them
- `Visibility.platform: Platform` (15e). `speciesVisible` adds `platform = 'plantrepro' OR (plant_type = 'tree' AND plant_type_status = 'reviewed')`.
- The region snapshot tables gain `platform` (15f).

## Review Focus

1. **A deploy with `PLANT_DOMAIN` unset.** The production `.env` is edited by hand, so the first deploys will not have it. Caddy must still start, TreeRepro must keep serving, and a request to any PlantRepro host is refused. Owned by 15b.
2. **Callers with an unexpected Host.** Three callers do not send the public host:
   - the Compose healthcheck (`wget http://127.0.0.1:3000/api/health`)
   - `scripts/deploy.sh` readiness
   - E2E (`localhost:8080`)

   Health routes are exempt from the host check, and the port is stripped. Owned by 15b.
3. **Sessions and keys created before the change.** A logged-in user must stay logged in on TreeRepro, and an existing API key must keep working there. Owned by 15b (sessions) and 15c (roles).
4. **`POST /api/batch` on PlantRepro.** Its internal `new Request(checked.url, …)` must keep the incoming host, so the operations run on PlantRepro. Owned by 15b.
5. **Work without a Host.** `seed:admin`, the digest, `build:snapshot`, imports and mail sent from jobs all run without a request host. They take an explicit platform, and mail links use that platform's origin. Owned by 15c (seed, mail) and 15f (snapshot).
