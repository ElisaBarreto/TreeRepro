# Weekly snapshot: region tables — Design

**Status:** approved by the owner, 2026-10-22 (epic #286, decision 4, issue #292). The rules are RFC-78 R7–R12.

## Why

The maps (#293) colour the TDWG level-3 regions with aggregates of the species summaries (RFC-77): completeness, statistics of the species medians, and the prevalence of each state. These aggregates cover every species and every region, so they are computed once a week and kept as a static version. The owner accepted a weekly refresh with no history.

## Design

- **D1 Tables** (RFC-78 R7). There are three region tables and a one-row `region_snapshot(computed_at)`. Region names stay in `wcvp_regions`, and percentages are computed when the tables are read, so both views (trees and all species) can share the same counts in phase 2.
- **D2 Inputs** (RFC-78 R8).
  - Species medians come from `continuousSummaries` (#289), which is a single statement, under the visibility of an ordinary signed-in viewer.
  - States per species come straight from the counted records (`countedRecordsSql`, exported from `species-summary.ts`). The region tables need only which species hold a state, not its counts.
  - A species' regions come from `wcvp_species_match` joined to `wcvp_distribution` (#291).
- **D3 One transaction** (RFC-78 R12). The medians are inserted as JSON into a temporary table. Then the region tables are deleted and re-inserted with set-based SQL, and `region_snapshot` is updated.
- **D4 Timer** (RFC-78 R12, RFC-74 R1). It is built like the digest timer: a tick every hour, the first one minute after start-up, logging failures and never throwing. It runs when no completed snapshot is younger than 7 days. The advisory lock `4665` keeps the timer and the CLI from running at the same time.
- **D5 Verification.** The tables are compared with the owner's `region_*_trees.csv`, produced by `platform_package/treerepro_summaries.R --trees-only` with WCVP v15, on the reloaded dev database.

## Out of scope

The all-species view (#295), drawing the maps (#293), the health page, and a history of snapshots.

## Testing

- Integration tests on a small fixture: species with matches in two regions, a species with no match, and quantitative and categorical traits. They check completeness counts and denominators, continuous statistics (n, mean, sample sd, median, min, max, cv only when the mean is positive), categorical counts with a species holding two states, an inactive species left out, a re-run replacing the snapshot, and a held lock recording `skipped`.
- A unit test of the due rule.
