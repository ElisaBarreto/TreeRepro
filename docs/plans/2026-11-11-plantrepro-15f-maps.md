# Plan 15f — Maps and the weekly snapshot per platform

**Spec:** `docs/specs/2026-11-11-plantrepro.md` §5. **Epic plan:** `docs/plans/2026-11-11-plantrepro.md`. **Gated:** run the 15a procedure on this branch, then wait for the owner's go before merging.

**After merge, TreeRepro users see** the same maps and the same values.

## Tasks

1. **RFCs.** RFC-78: the snapshot is built per platform; TreeRepro keeps the `wcvp_tree_species` denominators, PlantRepro uses `wcvp_species`. RFC-76: maps read their own platform's rows.
2. **Migration.** The region snapshot tables (`apps/api/src/db/schema/region-snapshot.ts`) gain `platform text not null default 'treerepro'` with a check over the platforms, then the default is dropped. The platform joins each table's key or unique index.
3. **Build.**
   - `apps/api/src/jobs/snapshot.ts` builds both platforms in one transaction, each with its species scope (Visibility with `platform`) and its denominator. It replaces `EVERY_VIEWER`.
   - `build:snapshot` runs both.
   - Test: the TreeRepro rows equal the current output on the same fixtures; the PlantRepro rows include a `not_tree` species and divide by all WCVP species.
4. **Read.** `/api/maps*` filters by `c.var.platform`. With no PlantRepro rows yet, the maps show the existing empty state.
5. **Rule 10:** update the route catalog, the guide, the changelog and the openapi hash if the responses change.
6. **Rehearsal.** Run 15a, then rebuild the snapshot on the restored copy. Check that TreeRepro's rows are identical to before. Get the owner's go.
