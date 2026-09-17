# TreeRepro — Workspace Design (plans 11a, 11b, 11c)

**Date:** 2026-09-17
**Status:** approved design; plans `2026-09-17-workspace-11a-contributions.md`, `-11b-dashboard.md`, `-11c-coverage.md`
**Scope:** the personal and supervisory views: a contributor's own records and annotations in one place; the home page as a dashboard that says where help is needed; coverage metrics for managers and admins. RFC-71 (my contributions), RFC-72 (workspace dashboard), RFC-69 R5–R7 (coverage metrics), amendments to RFC-13, RFC-30, RFC-31. Programme index: `2026-09-17-contributor-launch-overview.md`. Depends on plans 08b (plots), 09a (intent, review permission) and 10a (coverage table).

## 1. Context

The workspace landing page still says "Research data arrives in the next release". A contributor arriving from an invitation needs, in one screen: what the project is, what their scope is, where data is missing in it, what awaits their validation, and what they have already done. Managers and admins need the same screen to say how far the dataset is and what sits in the queues. Every number must come from stored counters or small tables (RFC-69), never from a scan of eight million rows per page load.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Contributions | `GET /api/me/contributions` (records or annotations of the viewer) and `GET /api/users/:id/contributions` (`contributions.read`, manager+). One page `/app/contributions`, reused for another user with `?userId=`. |
| Dashboard | One route `GET /api/me/dashboard` composes the sections the viewer is entitled to; each section is a small query or a cached number. Contributor sections need plots (a contributor without plots gets global hints instead of scope counts). |
| Dataset totals | `species`, `references`, `records` counts cached in Redis for one hour (`stats:dataset`); `records` is `sum(record_count)` over the coverage table (monotonic, so a stale hour never shows a smaller number than before). |
| Awaiting validation | Records of the viewer's plot species with no `confirm` annotation from anyone and no `withdraw`, on visible active traits. Computed per request from the plot species (hundreds) through `trait_records_species_trait_idx`; capped list of 20, count exact. |
| Missing cells | Plot species × visible active traits minus coverage rows; computed per request (plot species × ~100 traits). |
| Coverage metrics | `GET /api/coverage` over the coverage table with family / category / plot filters; Redis cache 10 minutes per filter combination; permission `coverage.read` (manager+). |
| Description text | Fixed copy in the web app with live counts substituted; contact e-mail from the copy (public project contact, not a user's PII). |

## 3. My contributions (RFC-71, new; plan 11a)

Category workspace, file `docs/rfc/70-workspace/71-my-contributions.md`.

- **R1** `GET /api/me/contributions?kind=records|annotations&traitId=&speciesId=&review=&intent=&from=&to=&cursor=&limit=` (`dataset.read`, visibility RFC-33). `kind` required. `from` / `to` are ISO dates (inclusive day bounds in UTC). `review` (records only) is one of RFC-63 R6's statuses; `intent` (records only) `contest | complement | none`.
- **R2** `kind=records`: manual records with `created_by = viewer`, newest first (keyset on `id`), as record items (RFC-63 R8 with plan 09a's `intent` and `respondsTo`) plus `isAccepted: boolean` (the record is the current accepted value of its species and trait) and `responseCount: number` (records responding to it).
- **R3** `kind=annotations`: the viewer's `record_annotations` newest first (keyset on `id`) as `{ id, kind, note, reference, createdAt, record: <record item> }`; the filters apply to the annotated record.
- **R4** `GET /api/me/contributions/summary` (`dataset.read`): `{ records, contests, complements, validations, disputes, withdrawn, accepted }` — counts of the viewer's manual records, those with each intent, their `confirm` annotations, their `dispute` annotations, their records with a `withdraw` annotation, and their records that are the current accepted value. One query per number over indexed columns; `record_annotations` gains index `(actor_id, id desc)` and `trait_records` gains partial index `(created_by, id desc) where created_by is not null`.
- **R5** `GET /api/users/:id/contributions` and `/summary` (`contributions.read`) answer the same for another user (404 `USER_NOT_FOUND`); the viewer's own visibility applies (a manager is unrestricted; the route never widens what the viewer may see).
- **R6** Nothing here writes; no audit entries.

Web (plan 11a): route `/app/contributions` (nav entry **My contributions**, section Data, icon `user`, permission `dataset.read`); header with the summary as small stat tiles; tabs **Records** / **Annotations**; filters (trait select from the dictionary, species combobox over `GET /api/species`, review select, intent select, date range) as URL params; the records tab is a `RecordTable` with an extra status column (review badge, "accepted" badge, "contest"/"complement" badge) opening the `RecordDrawer`; the annotations tab lists kind badge, date, the record's species and trait, the note, the supporting reference. With `?userId=` and `contributions.read`, the same page titles itself "Contributions of *Name*" (name from the record items or `GET /api/admin/users/:id` when `users.read`; otherwise the id) and calls the user routes. The user page (`/app/admin/users/$id`) gains a link "View contributions".

## 4. Workspace dashboard (RFC-72, new; plan 11b)

Category workspace, file `docs/rfc/70-workspace/72-workspace-dashboard.md`.

- **R1** `GET /api/me/dashboard` (`dataset.read`) answers `{ dataset, scope, contributor, curation }`:
  - `dataset: { speciesCount, referenceCount, recordCount, computedAt }` — global counts (active species only for `speciesCount`), cached one hour in Redis under `stats:dataset` (RFC-69 numbers).
  - `scope: { plots: [{ id, code, name, speciesCount }], speciesCount, restricted } | null` — null when the viewer has no plots.
  - `contributor: { missingCells, awaitingValidation: { count, records: [<record item>…] (≤ 20, newest first) }, topMissingTraits: [{ trait: { id, key, valueType, unit }, category: { key, label }, missingSpeciesCount }] (≤ 10, descending), summary: <RFC-71 R4> }` — the scope-dependent numbers are computed over the viewer's plot species; for a viewer without plots, `missingCells` and `awaitingValidation` are `null` and `topMissingTraits` is computed over every visible active species from the coverage table (`speciesWithData` per trait subtracted from the visible species count).
  - `curation: { coverage: { cells, withData, accepted, percentWithData, percentAccepted }, queues: { pendingGroups, disputed, contested, proposals } } | null` — present for viewers with `records.review`; `coverage` is RFC-69 R5 with no filter (cached); `pendingGroups` counts RFC-65 R8 groups, `disputed` RFC-65 R10 records, `contested` records with `intent = 'contest'` whose responded record is not withdrawn and has no accepted decision newer than the contest, `proposals` open proposals (RFC-75; 0 until plan 12c).
- **R2** Every list in the answer applies RFC-33 and RFC-67 (plot-bound viewers never receive species outside their plots).
- **R3** The web app renders the description of the project with `dataset` counts substituted: "TreeRepro is a collective data assembly of reproductive trait data for trees, covering traits across all reproductive stages — flower, fruits, and seeds. Its core data comes from open-source papers and data repositories spanning *N* references and *M* records over *S* species. It is shared here with a community of specialist scientists to fill gaps and validate existing records. For questions, contact elisabpereira@gmail.com." The copy lives in `apps/web/src/content/project.ts` so the owner can edit it in one place.

Web (plan 11b), `WorkspacePage`:

- **Intro card** with the description (R3) and the three counts.
- **Your scope** (when `scope`): plot chips with species counts; "Restricted to your plots" note when applicable; button **Browse species**.
- **Quick actions**: **Validate records** (→ `/app/species?scope=plots&sort=completeness` — or the first awaiting record's species), **Enter new data** (→ `/app/species?traitData=missing&scope=plots`), **Browse species**.
- **Records awaiting your validation**: table of up to 20 record items (species, trait, value, source) each opening the record drawer; count in the heading; empty state "Everything in your plots has been validated."
- **Top traits missing data in your plots** (or "…in the dataset" without plots): ranked list with the missing-species count, each linking to `/app/species?traitId=&traitData=missing&scope=plots`.
- **Your contributions**: the summary tiles with a link to `/app/contributions`.
- **Curation** (when `curation`): coverage tiles (`<meter>` elements for the percentages — no inline styles), queue tiles linking to Pending, Disputed, Contested (the disputed page gains a `?intent=contest` filter in this plan), Proposals (12c), and a link to the coverage page (11c).
- **Getting started** card: plan 12a.

The page reads one query (`dashboardQueryOptions`), shows skeleton rows while pending, and each section degrades independently (a `null` section is not rendered).

## 5. Coverage metrics (RFC-69 R5–R7; plan 11c)

- **R5** `GET /api/coverage?familyId=&categoryKey=&plotId=` (`coverage.read`, visibility RFC-33): over the visible active species (restricted by `familyId` or `plotId` when given) and the visible active traits (restricted by `categoryKey`): `{ species, traits, cells, withData, accepted, percentWithData, percentAccepted, byCategory: [{ category: { key, label }, traits, cells, withData, accepted, percentWithData, percentAccepted }], byTrait: [{ trait: { id, key, valueType, unit }, category, species: withData, accepted, percentWithData, percentAccepted }], computedAt }`. `withData` counts coverage rows in the selection; `accepted` counts species × trait pairs whose current decision is `accepted` (from `accepted_values`, newest row per pair); percentages are integers 0–100 rounded half up. Unknown family, plot or category → 404 / 400 as elsewhere; a plot-bound viewer asking another plot → 403.
- **R6** The answer is cached in Redis for 10 minutes under `coverage:<viewer visibility key>:<familyId>:<categoryKey>:<plotId>`; `computedAt` says when. The coverage table only grows, so a stale answer only under-reports.
- **R7** `GET /api/coverage/top?mode=missing|least_accepted&limit=` (`coverage.read`) answers the traits with the most visible species lacking data, or with the lowest accepted share, as `byTrait` items — the manager's version of the contributor's "top missing traits".

Web (plan 11c): route `/app/curation/coverage` (nav **Coverage**, section Curation, permission `coverage.read`); filters family (select over `GET /api/families`), category, plot (over `GET /api/plots`); headline tiles (species, traits, cells, % with data, % accepted) with `<meter>`s; a table by category expanding to its traits (chevron rows), each with two meters and the counts; links from a trait row to `/app/traits/$id` and to the species list in missing mode; **Top gaps** list (R7). Breadcrumb `Curation › Coverage`.

## 6. Error codes, audit actions, permissions

RFC-30: `contributions.read` "View any user's contributions" (11a, manager+), `coverage.read` "View coverage metrics" (11c, manager+); each plan's migration inserts the permission and the `manager` role row (RFC-31 R10). RFC-12 and RFC-41: nothing new. RFC-13 R2: routes `/app/contributions`, `/app/curation/coverage`.

## 7. Testing

- Contributions: records and annotations of one user only, filters, keyset order, summary counts, the other-user route by permission, visibility of a restricted viewer's own records on an inactive species (they are omitted — consistent with RFC-33, and the summary counts them anyway: state this in the RFC and test it).
- Dashboard: each section's numbers on a synthetic plot with known gaps; null sections by role; cache hit and refresh for `stats:dataset` (fake Redis clock via key TTL inspection); awaiting-validation excludes confirmed and withdrawn records.
- Coverage: totals and per-category / per-trait numbers on synthetic data with an inactive trait and an inactive species excluded; filter combinations; cache key; `top` modes.
- Web: page sections by role; links carry the right search params; meters render the right values (`value`/`max`); skeletons; contributions filters round-trip.
- E2E: a contributor's home shows their plot, a missing trait and an awaiting record; clicking through validates it and the count drops after refetch.

## 8. Out of scope

Leaderboards; e-mail summaries of a contributor's activity; per-contributor coverage; exporting the coverage table; charts beyond meters (a bar chart library would be a dependency and a CSP question).
