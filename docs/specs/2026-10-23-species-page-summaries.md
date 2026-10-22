# Species page shows the species summaries — Design

**Status:** approved by the owner, 2026-10-22 (epic #286 decision 4, issue #290).

## Why

The species page summarised a trait as a mean of each value field (RFC-63 R10, per unit). The owner's species value is different: the median of per-source medians for a continuous trait, and the main state for a categorical one (RFC-77). The page shows those numbers, computed live for the open species, so a new contribution shows at once.

## Design

- **D1 API** (RFC-63 R10). `GET /api/species/:id/traits` calls `continuousSummaries` and `categoricalSummaries` (#289) for this one species, under the viewer's visibility.
  - `numeric` is removed.
  - Each quantitative trait gains `continuous`.
  - Each categorical trait gains `categorical`.
  - Each level gains `nSources` and `shareOfRecords`.

  The trait page (RFC-62 R7, R8) keeps its per-field means; it is out of scope.
- **D2 Web trait card.**
  - Quantitative:
    - `Median 12.5 mm`, followed by the basis when it is a range midpoint or a single bound;
    - then `mean 12.1 ± 2.0 · 8–20 · 14 records · 3 sources`;
    - an amber **Outlier** badge, titled with the flag reasons, when the summary carries a flag.
  - Categorical:
    - `Main state: black — 75 % of records`, plus `(majority)` when it is one;
    - `States: black · brown` when the non-minority states are more than the main ones;
    - every level row adds its sources.
- **D3 External API.** The route's shape changes, so the guide, its changelog and the openapi hash are updated (rule 10).

## Out of scope

The trait page's summaries, the maps (#293) and the export (#294).

## Testing

- **API integration:** for one species, `continuous` gives the median of source medians; `categorical` gives the main state, share and majority, with `nSources` and `shareOfRecords` on its levels; a restricted viewer's summary leaves out what it cannot see; `missingOnly` traits carry null summaries.
- **Contract:** the new schema.
- **Web:** the card renders each line and the badge; levels show their sources.
