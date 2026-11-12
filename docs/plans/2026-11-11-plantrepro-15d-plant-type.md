# Plan 15d — Plant type on every species

**Spec:** `docs/specs/2026-11-11-plantrepro.md` §3, §6. **Epic plan:** `docs/plans/2026-11-11-plantrepro.md`. **Gated:** run the 15a procedure on this branch, then wait for the owner's go before merging.

**After merge, TreeRepro users see** a Plant type column, filter and species-page field, and two export columns. Every species shows `tree` / `reviewed`. Nothing is hidden yet: that is plan 15e.

## Tasks

1. **RFCs.**
   - RFC-60: the `plant_type` and `plant_type_status` columns, and their representation in the list, detail and filter.
   - RFC-64: an import sets the type from `is_tree_species` as `reviewed`, and never changes an existing species' type.
   - RFC-65: direct creation states the type; status `reviewed` when the creator holds `records.review`, `proposed` otherwise; changing a reviewed type is a `records.review` action, audited with the old and new value.
   - RFC-75: a proposal states the type; approval keeps it, or the approver changes it; status by the same rule.
   - RFC-66: two new export columns.
2. **Contracts.** Add `PLANT_TYPES`, `PlantType` and `PLANT_TYPE_STATUSES` to `platform.ts`, with labels `Tree` and `Not a tree`.
3. **Migration.**
   - Add both columns with defaults `'tree'` / `'reviewed'` and check constraints, then drop the defaults.
   - Add an index on `(plant_type, plant_type_status)`.
   - Add `species_proposals.plant_type text null`. Null is allowed for existing rows only; the API requires it.
4. **Setting the type.**
   - Proposal create, proposal approve and species create take `plantType`.
   - On TreeRepro the value is forced to `tree`. A request asking for anything else gets 400 `VALIDATION_FAILED` on path `plantType`.
   - The status follows `records.review`.
   - Tests cover both platforms and both kinds of creator.
5. **Change type.** `POST /api/species/:id/plant-type { plantType }` (`records.review`) sets `reviewed` and is audited.
6. **Import.** `import:records` sets `plant_type` from the row's `is_tree_species` for the species it creates. Test: a `--trees-only` run creates only `tree` / `reviewed` species, and an existing species keeps its type.
7. **Read side.**
   - The list item and detail gain `plantType` and `plantTypeStatus`.
   - `GET /api/species?plantType=` filter, and `sort=plantType`.
   - The SPA adds the column, the Scope-group filter, the species-page field and the change action.
   - The type selector in the proposal and create forms is shown only when the platform is PlantRepro. On TreeRepro the form shows “Tree” as fixed text.
8. **Export.** `records.csv` gains `plant_type` and `plant_type_status`, placed after the existing species columns. Test that every pre-existing column is unchanged.
9. **Rule 10:** update the route catalog, the guide, the changelog and the openapi hash.
10. **Rehearsal.** Run 15a on this branch: every species is `tree` / `reviewed`, and the export checksum of the old columns is unchanged. Get the owner's go.
