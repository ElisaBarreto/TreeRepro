# PlantRepro: a second platform on the same database

Status: design, awaiting owner approval (2026-11-11). Brainstormed with Rafael.

## Intent

TreeRepro collects reproductive-trait data for **tree** species only. The project now wants the same work for **every plant**, gymnosperms and angiosperms. That work happens on a second site called **PlantRepro**, and it shares everything with TreeRepro:

- the same database
- the same trait dictionary and classification rules
- the same curation workflow

TreeRepro keeps showing only trees. PlantRepro shows everything. A change made on one site, such as a record, a validation, a contest or a catalog edit, is visible on the other whenever the species is in that site's scope.

The data already in TreeRepro is **production data**. Nothing in this project may lose, rewrite or reinterpret it.

## Goals

1. PlantRepro is served at its own address with its own name, emblem and colours, so nobody confuses the two sites. Every page, rule and feature of TreeRepro exists on PlantRepro.
2. **No feature is ever exclusive to one platform.** Every future rule, screen or change applies to both. This is a durable project rule. It goes into `CLAUDE.md` and the RFCs, and the code structure enforces it: one codebase, one SPA build, one API.
3. Every species has a **plant type**. For now the type is either `tree` or `not_tree`, kept as a list that can grow later (shrub, herb, liana, palm…) without a schema change. TreeRepro shows only species whose type is `tree` and has been reviewed.
4. **One user account**, holding a role **per platform**:
   - `admin` is always admin of both platforms.
   - `manager`, `contributor` and custom roles are assigned per platform.
   - A user with no role on a platform cannot use that platform.
5. Every current TreeRepro user, record and annotation keeps working exactly as today.

## Non-goals

- A second database or schema, or a second frontend codebase.
- Single sign-on across the two sites. The owner accepted signing in separately on each site with the same e-mail, password and TOTP.
- Plant types beyond `tree` / `not_tree`, and a gymnosperm / angiosperm field (the family already tells it).
- Importing the non-tree data. A later import will add it once the platform is ready; it gets its own issue and its own production procedure.
- Visual refinement beyond a first, clearly distinct identity (see Branding). The owner will refine the visuals later.

## Anti-goals

These would make the project a failure even if it technically worked:

- Any loss or silent change of current production data. This includes records, annotations, contests, species, roles, sessions, API keys and the audit log.
- A current TreeRepro user noticing any change in what they see or can do, apart from the new admin controls and the plant-type field.
- A feature, fix or rule that works on one platform and not the other.
- A user seeing on TreeRepro a species that is not a reviewed tree, or reaching a platform they hold no role on.
- The two sites looking similar enough to be confused.

## Constraints

- Every existing project rule applies: RFC first, then a failing test, then code; no database mocks; every route guarded; migrations additive; English artifacts (see `CLAUDE.md`).
- Production runs on one small VPS (1 vCPU / 4 GB) behind Cloudflare. PlantRepro shares the same server, Compose stack, Postgres, Redis and backups.
- Migrations must be safe on production data: additive columns with defaults and a backfill in the same migration. No destructive step.
- `apps/api/drizzle` on `origin/main` decides the next migration number (last one is `0056` today).

## Decisions taken with the owner

| Topic | Decision |
|---|---|
| Name and address | `PlantRepro` at `plantrepro.elisabarreto.com.br`, next to `treerepro.elisabarreto.com.br` (default accepted). |
| Identity | Own emblem and colours, clearly different. First version: the TreeRepro tree in a small forest (conifer, flower, fern, grass) on a **plum** disc (mockup option A, “Bloom”). To be refined later. |
| Codebase | One SPA and one API serve both platforms. The host decides the platform. No feature is exclusive. |
| Login | Separate session per site, same credentials. Password managers should offer the same login on both sites. |
| Roles | One account. `admin` is admin of both. Other roles per platform. Admins grant and revoke access. |
| Existing users | Keep their current roles on TreeRepro. They start with **no access** to PlantRepro until an admin grants it. |
| Plant type | Whoever registers a species states its type. **Any manager of either platform** reviews it. For now only `tree` / `not_tree`, extensible. |
| Existing species | All become `tree`, reviewed. The tree basis (`tree_flag`) is unchanged. It remains the evidence for why the species counts as a tree. |
| Pending species | A species whose type is proposed, or `not_tree`, is visible only on PlantRepro. |
| Reclassification | A species changed from tree to not_tree leaves TreeRepro. Its records and history stay, visible on PlantRepro. |
| Shared catalog | Traits, levels, categories, references, field plots and the trait dictionary are shared by both platforms. |
| Maps | On TreeRepro, completeness is divided by the known **tree** species of the region, as today. On PlantRepro, it is divided by **all** species of the region. |
| Export | Each site exports what it shows. The TreeRepro export keeps today's rows and values (plus the two plant-type columns, section 6). |

## How it works

### 1. The platform of a request

- Two platform keys are added to `packages/contracts`: `treerepro` and `plantrepro`. Each carries its display name and its brand.
- **API.** The platform is resolved once per request from the `Host` header, matched against the configured domains: `DOMAIN` for TreeRepro and a new `PLANT_DOMAIN` for PlantRepro. Caddy serves only those two hosts.
  - In development, `localhost` resolves to TreeRepro and `plantrepro.localhost` to PlantRepro. Browsers resolve `*.localhost` to loopback.
  - Any other host is refused.
  - The platform goes into the request context next to the session.
- **Sessions.** A session record (Redis) records the platform it was created on; a record without one, created before this change, reads as TreeRepro. A session presented on the other host is refused. The `__Host-` cookie already prevents this, and the stored platform makes it explicit.
- **API keys.** A key reaches the platform of the host it is sent to: `tr_live_…` sent to `plantrepro.…/api/...` acts on PlantRepro. A key belongs to an admin, and admin holds both platforms, so a key works on both hosts.
  - The `tr_live_` prefix is kept, so existing keys keep working.
  - The API guide documents the second host.

### 2. Roles per platform

- `user_roles` gains a `platform` column. Every existing row is backfilled to `treerepro` in the migration.
- `admin` is platform-independent. Holding it on one platform means holding it on both. How that is stored is left to the builder, with one requirement: an admin can never end up admin on only one platform.
- Effective permissions (RFC-32 R1) are resolved for `(user, platform)`. Every cache keyed by user gains the platform.
- `setUserRoles` becomes per platform. The anti-lockout rule (RFC-31 R7), the delegation ceiling (R12), the self-change ban (R13) and the admin-only permissions (R15) all apply per platform. The last-admin rule stays global, since admin is global.
- **Login on a platform where the user holds no role** succeeds for the credentials and is then refused. The answer is a 403 with a code such as `PLATFORM_ACCESS_DENIED`, and the SPA shows “You have no access to PlantRepro”. Rationale: the account exists on the other platform anyway, and a vague error would only confuse the user. The refusal is audited.
- **Admin UI.** The user page shows one role section per platform. The user list can filter by platform. Invitations name the platform and its roles. The invitation e-mail is branded for that platform and links to its host.
- **Suspension, password reset and TOTP** remain per account, so they affect both platforms. The TOTP secret is one per account, and the same authenticator code works on both sites.
- **Role definitions are shared** (my call). `roles` and `role_permissions` stay one set; only the *assignment* (`user_roles`) is per platform. A custom role means the same thing wherever it is assigned.
- **People-management permissions act account-wide** (my call): `users.read`, `users.invite`, `users.update`, `users.suspend`, `users.delete`, `roles.manage`, `sessions.revoke`, `admin.access` and the audit permissions. They are checked on the platform the request comes from, as every permission is, but what they act on is the whole account list: a holder sees and manages every user, whatever platforms that user works on, and assigns roles on either platform within the delegation ceiling (RFC-31 R12, evaluated on the platform being assigned). In practice only `admin` holds them; this keeps one user list and one audit log.
- **Field-plot restriction stays per account** (my call): `restrict_to_assigned_plots` and `user_plots` apply on both platforms unchanged.
- **Active users with no role today.** `setUserRoles` accepts an empty set, so such users may exist; today they can sign in and reach only Settings. The rule "no role on a platform = refused" would lock them out of TreeRepro. The production rehearsal counts them; if any exist the owner decides, per user, before the migration ships (my call: count first, decide with data).

### 3. Plant type

- `species` gains two columns:
  - `plant_type`: text, not null, check constraint over a list in `packages/contracts`, today `tree` and `not_tree`. Extending the list later is a contracts change plus a migration that widens the check.
  - `plant_type_status`: `proposed` or `reviewed`.
- The migration backfills every existing species to `tree` / `reviewed`.
- **Setting the type:**
  - A species proposal (RFC-75) requires the proposer to state the type.
  - Creating a species directly (RFC-65 catalog writes) requires the creator to state it.
  - The species starts `reviewed` when the person who sets the type holds `records.review` (manager or admin), and `proposed` otherwise.
  - Approving a proposal keeps the proposer's stated type. The approver may change it, and the approval decides the status by the same rule.
- **Review queue.** A new curation queue, `/app/curation/plant-types` (`records.review`), lists species with `plant_type_status = 'proposed'`. Its actions are **Confirm**, and **Change type and confirm**. The queue appears on both platforms, because any manager of either may review. It joins the dashboard queue counts (RFC-72) and the digest (RFC-74).
- **The review queue is a documented visibility exception** (my call, follows "any manager of either platform"). Its list and its two actions apply the usual active/plot visibility but **not** the platform condition of section 4, for `records.review` holders only. A TreeRepro manager therefore sees and decides proposed species in the queue (name, family, genus, proposer, stated type, note) without the species page becoming reachable on TreeRepro. The exception is listed in RFC-33 next to the other bypasses and has its own tests and audit.
- **Imports set the type from the file** (my call). A species created by `import:records` gets `plant_type` from the row's `is_tree_species` (`true` → `tree`, `false` → `not_tree`), status `reviewed`: the owner's release is the reviewed source, as it already is for `tree_flag`. Runs with `--trees-only` (every production run so far) therefore only ever create `tree` species. An import never changes the type of an existing species.
- **TreeRepro registers only trees** (owner, 2026-11-11). On TreeRepro the type is not a choice: every species proposed, approved or created there is `tree`. The type selector exists only on PlantRepro. This is scope, not an exclusive feature: the form is the same, the platform fixes the value.
- **A name that exists but is hidden on TreeRepro** (a `not_tree` or `proposed` species) cannot be registered there again. The proposal or creation is refused. My call on the wording: the refusal says the species already exists and is not classified as a tree on TreeRepro, without linking it, and that a manager can review its type. Alternative names follow the same rule.
- **Approving a not-tree proposal on TreeRepro** cannot happen, since TreeRepro proposals are always `tree`. On PlantRepro, an approved `not_tree` proposal (`taxa.manage`, admin by default) creates a species visible only on PlantRepro.
- **Changing the type of a reviewed species** is a `records.review` action on the species page. A reviewed `not_tree` species is not visible on TreeRepro, so turning it into a tree is done from PlantRepro (my call). It is audited with the old and new type.
- The type and its status are shown on the species page and in the species list, as a column and a filter. They are included in the export.

### 4. Visibility per platform (the core of the scope)

- `Visibility` (RFC-33 R1) gains the platform. `speciesVisible` gains one condition:

  ```
  platform = 'plantrepro' OR (plant_type = 'tree' AND plant_type_status = 'reviewed')
  ```

- This condition flows into every read that already uses `speciesVisible`: species, records, taxa, traits counts, references, coverage, dashboard, contributions, proposals, contests and export.
- The RFC-33 R10 meta-test already forces every dataset-reading route through `Visibility`.
- **Bypasses to review one by one** (recon list):
  - `UNRESTRICTED` uses in `catalog.ts`, `references.ts`, `admin/health.ts`, `jobs/digest.ts` and `cli/verify-summaries.ts`.
  - The snapshot's `EVERY_VIEWER`.
  - The caches behind `globalSpeciesVisible`, which are keyed only by active/inactive today. Each such cache gains the platform in its key.

  Each bypass is either scoped or documented as platform-wide on purpose.
- **Writes** (records, annotations, contests, catalog writes) on a species outside the viewer's platform answer 404 like any invisible species. A TreeRepro user therefore cannot write to a non-tree species through the API either.
- **Genera and families** with no species visible on the platform are omitted, as already happens for invisible species.

### 5. Maps and the weekly snapshot

- The snapshot (RFC-78 R7–R12) is computed **per platform**, tagged with a platform column, in the same transaction and weekly job.
- TreeRepro's denominators stay `wcvp_tree_species`. PlantRepro's are all `wcvp_species`.
- `/api/maps*` reads its platform's rows.
- `build:snapshot` builds both platforms.
- Before the first PlantRepro snapshot exists, PlantRepro maps show the usual empty state.

### 6. Export, counts, digest

- `GET /api/export/dataset.zip` exports the platform's visible species. Its audit entry records the platform.
- Both platforms' exports gain the `plant_type` and `plant_type_status` columns (no exclusive feature). "TreeRepro exports exactly today's data" means the same rows and the same values in every existing column; the rollout comparison checks that, ignoring the two new columns. The API changelog announces them.
- Dashboard counts, coverage and “My contributions” follow visibility.
- The digest, off by default, sends each recipient one e-mail per platform they review in, branded for that platform. This is the builder's call within that shape.

### 7. Branding

- One SPA build. The SPA decides the platform from `location.hostname`: a first label of `plantrepro` means PlantRepro, anything else TreeRepro. It then sets `data-platform` on `<html>` before first paint, so the wrong brand never flashes.
- Theme tokens (canopy/pollen today) get a plum set under `[data-platform="plantrepro"]`. The colour difference must hold in light and dark mode, the header and the emblem at the very least.
- The forest emblem from the mockup becomes `Emblem` variant `plantrepro` and a second favicon. The page title, the landing page copy (“trees” becomes “plants”) and the e-mail templates (name, sender display name and links per platform) all follow the platform.
- The TOTP issuer, OpenAPI title and User-Agent strings follow the platform where that is visible to the user. Otherwise they stay neutral.
- **Password managers.** Both hosts serve `/.well-known/assetlinks.json`, declaring each other with `delegate_permission/common.get_login_creds`. Google Password Manager then offers one login for both sites, and Bitwarden and 1Password already match by base domain.
  - The login form keeps standard `autocomplete` attributes.

### 8. Infrastructure and rollout

- **Caddy.** One site block serves `{$DOMAIN}, {$PLANT_DOMAIN}`, with the same headers, CSP and logs. Production adds `PLANT_DOMAIN` to `.env`.
- **Mail links.** They use the platform's origin, so `APP_ORIGIN` becomes per platform.
- **DNS.** The Cloudflare record for `plantrepro.elisabarreto.com.br` is created by Rafael at the end, proxied like TreeRepro. Until it exists PlantRepro is unreachable, so the code can ship to production dark.
- **E2E.** The suite runs against both hosts. At minimum it covers:
  - the brand on each host
  - a tree species visible on both
  - a non-tree species visible only on PlantRepro
  - a user without a PlantRepro role refused there
  - a record added on one site appearing on the other
- **Production safety procedure**, before the first deploy of the migrations:
  1. Verify that the last off-site backup restores.
  2. Rehearse the migrations on a restored copy of production, locally.
  3. Compare key counts and the TreeRepro export before and after: species, records, annotations, contests, users, roles. Nothing may change apart from the new columns.

  It is written into `docs/gotchas/` and run with an explicit go from the owner.

### 9. Documentation and rules

- A new platform RFC, for example in `docs/rfc/10-platform/`, holds:
  - the platform concept and the Host rule
  - the “no exclusive feature” rule
  - the plant-type scope rule
- Updated RFCs:
  - 31 and 32 (roles and permissions per platform)
  - 33 (visibility)
  - 20 (invitations)
  - 22 (sessions)
  - 60 (`plant_type`)
  - 65 and 75 (setting and reviewing the type)
  - 66 (export)
  - 72 and 74 (queue counts)
  - 76 and 78 (maps per platform)
  - 82 (API host)
  - 13 (presentation and branding)
- `CLAUDE.md` gains the platform in its Layout and the rule “every feature applies to both platforms”.
- The API guide and its changelog are updated (rule 10).

## Left to the builder

- How `admin`'s platform-independence is stored, within the requirement in section 2.
- The exact names of codes, columns and the new RFC number.
- The order of the plans. Suggested order: platform resolution and roles → plant type and visibility → maps and export → branding → infra and rollout.
- The exact plum palette within the chosen direction, and the emblem drawing details.
- The digest details within section 6.
- Calls marked “my call” in the list handed to the owner with this document.
