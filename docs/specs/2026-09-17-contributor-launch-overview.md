# TreeRepro — Contributor Launch Programme (plans 08–12)

**Date:** 2026-09-17
**Status:** approved design; nothing implemented yet
**Scope:** the map of the work that turns the curated dataset into a platform a community of ~50 specialist scientists can use: roles and data visibility, field plots, the redesigned contribution workflow, the browsing redesign (species, traits, references), personal views (home dashboard, my contributions, coverage), and the platform pieces (help pages, daily digest, species proposals, health page). Source: the owner's conceptual plan of 2026-09-16 (local document, not committed). Every decision below was confirmed with the owner on 2026-09-17.

This file is the index. Each track has its own design spec; each issue has its own implementation plan under `docs/plans/`.

## 1. Tracks, issues, plans

| Track | Spec | Issue (plan) | Summary |
|---|---|---|---|
| 1 Visibility | `2026-09-17-visibility-design.md` | **08a** roles + species activation | `species.active`; permission `dataset.read_inactive`; system roles `manager` and `contributor`; API hides inactive species and traits from restricted viewers; `seed:traits` `active` column; generic supplementary import batches; `import:species-status`. |
| | | **08b** plots | `plots`, `plot_species`, `user_plots`, `users.restrict_to_assigned_plots`; `import:plots`, `import:plot-species`, `import:user-plots`; Admin › Plots; species `scope` and `plotId`; "Show species outside my plots". |
| 2 Contribution | `2026-09-17-contribution-design.md` | **09a** contribution API | Personal-observation references; DOI resolution through the Handle and Crossref APIs; `POST /api/records` with several references (one record each) and an intent (contest / complement); automatic dispute on contest; `records.review` permission; confirm with a supporting DOI; species trait summary with missing traits. |
| | | **09b** contribution web | Validate / Add different record; the two-step contest dialog; "Add entries for another trait"; live DOI check; `?` trait tooltips; "Show traits with no data". |
| 3 Browsing | `2026-09-17-browsing-design.md` | **10a** species tab + coverage | `species_trait_coverage` and `species.trait_count` maintained by trigger; trait filters (category → trait, with / missing data); order by completeness; hierarchical breadcrumb. |
| | | **10b** synonyms | `species_names` with `name_type`, `language`, `source`; `import:synonyms`; three-tier search (exact canonical → canonical substring → alternative names); "found as". |
| | | **10c** traits tab + trait page | Filters (category, trait, value type); levels as chips; `/app/traits/$id` with species with / missing data. |
| | | **10d** references enriched | `short_citation`, `full_citation`; `import:references`; DOI links; `reference_traits` and filters by trait / category. |
| | | **10e** distribution | `species_distribution`; `import:distribution`; country / state filters. Blocked until the dataset exists. |
| 4 Workspace | `2026-09-17-workspace-design.md` | **11a** my contributions | `GET /api/me/contributions`; `/app/contributions`; any user's list with `contributions.read`. |
| | | **11b** home dashboard | Project description; `GET /api/me/dashboard`; contributor cards and queues; manager / admin coverage and queue cards. |
| | | **11c** coverage dashboard | `GET /api/coverage` with family / category / plot filters; `/app/curation/coverage`. |
| 5 Platform | `2026-09-17-platform-design.md` | **12a** help + onboarding | `/app/help/*`; "Getting started" card until the first contribution. |
| | | **12b** daily digest | `job_runs`; hourly timer sending a daily e-mail to managers and admins when there was activity. |
| | | **12c** species proposals + lookup | `species_proposals`; GBIF backbone and WCVP checklist match; `/app/curation/proposals`; approve creates the species. |
| | | **12d** platform health | `GET /api/admin/health`; `/app/admin/health`. |

## 2. Order and dependencies

```
08a ─▶ 08b ─▶ 09a ─▶ 09b ─▶ 10a ─▶ 11b ─▶ 11a ─▶ 12a      (contributor launch)
                 │             │
                 │             ├─▶ 10c ─▶ 10b
                 │             ├─▶ 11c
                 │             └─▶ 10e
                 ├─▶ 10d
                 ├─▶ 12b ─▶ 12d
                 └─▶ 12c
```

- **Short term (must ship before contributors are invited):** 08a, 08b, 09a, 09b, 10a, 11b, 11a, 12a.
- **Medium term:** 10b, 10c, 10d, 12b.
- **Long term:** 10e (waits for the distribution dataset), 12c, 11c, 12d.

Hard dependencies: 08b needs 08a (visibility rules, `import_batches.kind`); 09b needs 09a; 10a needs 08b (scope toggle sits in the same filter panel); 11b needs 08b (plot scope) and 10a (coverage table); 11c needs 10a; 10c needs 10a (coverage anti-joins) and the breadcrumb from 10a; 10b, 10d, 10e need 08a (import batch kinds); 12b needs 09a (contest counts); 12d needs 12b (`job_runs`); 12c needs 09a (permission migration pattern) and 11a (the proposals tab).

## 3. Cross-cutting decisions

| Topic | Decision |
|---|---|
| Roles | Keep the RBAC of RFC-30–32. Two more **system roles** seeded by migration, `manager` and `contributor`, with fixed permission sets; they cannot be edited or deleted (409 `ROLE_IS_SYSTEM`). Later plans that add a permission to a system role insert the `role_permissions` row in their own migration. Administrators may still create custom roles. |
| Visibility | A new RFC-33 (access control) owns row-level visibility: inactive species and traits are invisible to viewers without `dataset.read_inactive`; a viewer with `restrict_to_assigned_plots` never sees a species outside their plots. Enforced in the API services, not in the UI (RFC-02). |
| Imports | Every new dataset arrives through a CLI command, never a web upload. All commands share `import_batches` (new column `kind`) and the report conventions of RFC-68. Imports insert what is missing and never change an existing row, except the two commands whose purpose is to set a flag or fill an empty field (`import:species-status`, `import:references`), and each says so in its RFC. |
| Provenance | Records stay one claim from one reference (RFC-63). A form with N references creates N records in one transaction. A personal observation is a reference of kind `personal_observation` owned by the observer (one per user), so two scientists observing the same value are two claims and one scientist repeating theirs is a duplicate. |
| DOI | `GET /api/references/resolve?doi=` checks a DOI without writing; the record write resolves and creates the references it needs. Outbound calls go to two fixed hosts only (`doi.org` Handle API, `api.crossref.org`), with `redirect: 'manual'`, a 5 s timeout and a fake client in tests. |
| Contest / complement | A new record carries `intent` and `responds_to_record_id`. A contest also inserts a `dispute` annotation on the contested record by the same actor (generated note), so the disputed queue keeps working; withdrawing the contest inserts a `neutral`. A complement inserts nothing on the older record. |
| Buttons | Everyone with `records.annotate` sees Validate and Add different record. Neutral and Dispute-with-note need `records.review` (manager+); Withdraw stays with the author or `records.withdraw`; Set as accepted stays `accepted.manage` (admin). |
| Trait detail | A dedicated page `/app/traits/$id` (option B), mirroring the reference page. |
| `species.active` default | `true` for every existing row; the owner's status file deactivates the species outside the current phase. |
| Notifications | A daily e-mail digest to managers and admins; no in-app notifications. |
| Export | Unchanged (`dataset.export`, admin); contributors download nothing. |
| Onboarding | Help pages authored as TSX under `/app/help`, and a "Getting started" card on the home page; no interactive tour. |
| Species proposals | Contributors propose a name; the API looks it up in GBIF (backbone and WCVP checklist) and stores the match; an admin approves (creating the species) or rejects. |
| Breadcrumb | The shell breadcrumb becomes hierarchical (`Data › Species › Anathallis funerea`) through a breadcrumb context that pages extend. |
| Counters | Aggregates that a page needs at scale are stored and maintained by the existing `trait_records` insert trigger (records are append-only, so counters never go down): `species_trait_coverage`, `species.trait_count`, `reference_traits`. |
| Hosted content | No dataset file is ever committed; fixtures in tests are synthetic. |

## 4. RFC allocation

New RFCs (each starts as `draft` and becomes `accepted` when its plan merges):

| RFC | Title | Category | Plan |
|---|---|---|---|
| RFC-33 | Data visibility | access | 08a (species, traits), 08b (plots) |
| RFC-52 | Platform health | admin | 12d |
| RFC-67 | Field plots | dataset | 08b |
| RFC-68 | Supplementary imports | dataset | 08a; kinds added by 08b, 10b, 10d, 10e |
| RFC-69 | Coverage summary | dataset | 10a; coverage metrics in 11c |
| RFC-70 | Contribution workflow | workspace | 09a |
| RFC-71 | My contributions | workspace | 11a |
| RFC-72 | Workspace dashboard | workspace | 11b |
| RFC-73 | Help and onboarding | workspace | 12a |
| RFC-74 | Daily digest | workspace | 12b |
| RFC-75 | Species proposals | workspace | 12c |
| RFC-80 | DOI resolution | integrations | 09a |
| RFC-81 | Taxonomy lookup | integrations | 12c |

`docs/rfc/README.md` gains two categories: `70–79 workspace` (`70-workspace/`) and `80–89 integrations` (`80-integrations/`).

Amendments: RFC-12 (codes), RFC-13 (routes), RFC-22 (`me`), RFC-30 (permissions), RFC-31 (system roles), RFC-32 (R7 points at RFC-33), RFC-41 (actions), RFC-50 (user plots), RFC-60 (active, names, search, distribution, filters), RFC-61 (kinds, citations, traits), RFC-62 (active on seed, trait detail routes), RFC-63 (intent, coverage), RFC-64 (`kind`), RFC-65 (multi-reference create, review permission, contest side effects), RFC-42 (job runs).

New permissions (RFC-30): `dataset.read_inactive`, `plots.manage`, `records.review`, `contributions.read`, `coverage.read`, `taxa.propose`, `health.read`.

System role permission sets (RFC-31):

- `contributor`: `dataset.read`, `records.create`, `records.annotate`, `taxa.propose`.
- `manager`: everything of `contributor` plus `dataset.read_inactive`, `records.review`, `records.withdraw`, `imports.read`, `contributions.read`, `coverage.read`.
- `admin`: every permission (unchanged).

## 5. Out of scope

Species and reference merges; in-app notifications; contributor exports; an interactive tour; web uploads of any dataset; per-record e-mail alerts; resource-level permissions beyond RFC-33.
