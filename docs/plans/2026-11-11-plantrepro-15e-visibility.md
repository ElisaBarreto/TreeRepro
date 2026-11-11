# Plan 15e — Visibility per platform and the plant-type review queue

**Spec:** `docs/specs/2026-11-11-plantrepro.md` §3, §4, §6. **Epic plan:** `docs/plans/2026-11-11-plantrepro.md`.

**After merge, TreeRepro users see** the same data as today, because every species is `tree` / `reviewed`. Managers also see a new Plant types queue, which is empty.

## Tasks

1. **RFCs.**
   - RFC-33: `Visibility.platform`; the platform condition in R2; writes on an out-of-platform species answer 404; the list of bypasses, including the review-queue exception.
   - RFC-65: the plant-type queue and its actions.
   - RFC-72 and RFC-74: the queue's counts.
   - RFC-60: the refusal of a hidden name on TreeRepro.
2. **Visibility.**
   - `visibilityOf` fills `platform` from `c.var.platform`.
   - `speciesVisible` and `globalSpeciesVisible` add the platform condition.
   - Two-platform fixtures: a tree, a `not_tree` and a proposed tree species.
   - Extend the RFC-33 R9 viewer tests:
     - on TreeRepro, the `not_tree` and proposed species are absent from every list, detail, count, coverage figure, contribution and export
     - on PlantRepro, all three are present
     - on TreeRepro, a write to the `not_tree` species answers 404
3. **Bypasses.** Review each one:
   - `UNRESTRICTED` uses in `catalog.ts`, `references.ts`, `admin/health.ts`, `jobs/digest.ts` and `cli/verify-summaries.ts`
   - the snapshot's `EVERY_VIEWER`, which is deferred to 15f

   Scope each one to the platform, or document it in RFC-33 as platform-wide with its reason.
4. **Caches.** Every cache behind `globalSpeciesVisible` (`dictionary.ts`, `trait-page.ts`, `coverage.ts`) and the `stats:*`, `dashboard:*`, `coverage:*`, `dictionary:*` and `trait:*` keys gains the platform in its key. Update `scripts/deploy.sh`'s flush patterns if the key shapes change.
5. **Hidden names on TreeRepro.** Proposal create, species create and alternative-name add refuse a name held by a species that is hidden on TreeRepro. The answer is 409 `SPECIES_NAME_TAKEN`, with a message saying the species exists, is not classified as a tree here, and that a manager can review its type. It carries no id and no link.
6. **Plant-type queue.**
   - `GET /api/curation/plant-types` lists `plant_type_status = 'proposed'` species.
   - `POST /api/species/:id/plant-type/confirm { plantType? }` confirms the type, optionally changing it.
   - Both need `records.review`. They apply active and plot visibility but not the platform condition, which is the RFC-33 exception.
   - The SPA page is `/app/curation/plant-types`, linked next to the other queues.
   - The dashboard `queues.plantTypes` count and the digest's count are added.
   - Tests: a TreeRepro manager lists and confirms a proposed species, while its species page still answers 404 on TreeRepro until it is confirmed as `tree`.
7. **Rule 10:** update the route catalog, the guide, the changelog and the openapi hash.

**Verify:** the full suite plus E2E. On `plantrepro.localhost`, a contributor proposes a `not_tree` species and the admin approves it. It shows on PlantRepro only. A record added to a tree species on PlantRepro shows on TreeRepro.
