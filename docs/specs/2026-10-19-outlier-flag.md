# Outlier flag on imported records — Design

**Status:** approved by the owner, 2026-10-19.

## Why

The owner's compiled dataset gains a 36th column, `outlier_flag`. It carries the result of the pipeline's outlier audit (`species_continuous_value_outlier_audit.csv`). The platform must keep that flag on each record, show it, and let a viewer find the species that have flagged records.

The owner's summaries and maps use the median, so a flagged value does not need to be kept out of any summary.

## What the owner decided

- **F1 Column.** `outlier_flag` is the 36th and last column, after `records_behind_row`. The other 35 columns keep their place.
- **F2 Values.** The column is empty, or holds one of `species_disagreement`, `trait_extreme` or `both`. These are the audit's `flag_reason` values.
- **F3 Effect.** The platform shows the flag and offers a filter for it. Summaries, coverage, maps, contests and the curation queues ignore it.

## Design

- **D1 Header** (RFC-64 R2). The header is exactly the 35 columns of 2026-10-05 followed by `outlier_flag`. Any other header is `header_mismatch`, and that includes the 35-column one. This follows the precedent of #256, which refused the 30-column layout.
- **D2 Check** (RFC-64 R7). On every row, categorical rows included, a non-empty `outlier_flag` that is not one of the three values makes the row `invalid_measurement`, exactly like `summary_source`. The value is trimmed with whitespace collapsed before the check.
- **D3 Storage** (RFC-64 R6, RFC-63 R1).
  - A migration adds `trait_records.outlier_flag text null`, with a check that limits it to the three values.
  - Every record of the row stores the flag, split categorical parts included; it is null when the column is empty.
  - The flag enters neither `value_text` nor the claim key.
  - Manual records (`TR_`) leave it null.
  - A partial index `(species_id) where outlier_flag is not null` serves D5.
- **D4 Record API** (RFC-63 R8). The record **item**, not only the detail, gains `outlierFlag: 'species_disagreement' | 'trait_extreme' | 'both' | null`, so the record table can show it.
- **D5 Species search** (RFC-60 R6). `GET /api/species` gains `outliers=true`, which keeps the species that have a **visible** record (RFC-33) whose `outlier_flag` is not null, on a visible trait. It is open to every viewer, like `contested`: the flag belongs to a record the viewer may already see, so the plot restriction is unaffected.
- **D6 UI** (RFC-13).
  - The record table shows an amber **Outlier** badge, whose tooltip names the reason:
    - `species_disagreement` → "Disagrees with this species' other values"
    - `trait_extreme` → "Extreme for this trait"
    - `both` → "Disagrees with this species' other values and extreme for this trait"
  - The record drawer gains an **Outlier** row in its provenance list, showing the same text.
  - The species search's **Scope** group gains an **Outliers only** checkbox, bound to `?outliers=true`.
- **D7 Export** (RFC-66 R2). `records.csv` gains `outlier_flag` after `records_behind_row`.
- **D8 External API** (RFC-82 R16–R21, CLAUDE.md rule 10). In the same PR: the guide `docs/api/guide.md`, its changelog and the `openapi-sha256` line. The route catalog derives from the contracts.
- **D9 Existing data.** Records are append-only, and an incremental import (RFC-64 R14) skips every `EB_n` already stored. Sending the new file again therefore does **not** flag the existing records. They get their flags when the owner reloads the imported records:
  - `--replace-imported`, which keeps the platform data;
  - or the total `--replace --discard-platform` while the platform is still in its test phase.

  `docs/gotchas/import.md` says so.

## Out of scope

- Keeping flagged values out of summaries or maps (F3).
- A curation queue for outliers.
- A per-record outlier filter on the records list. Add it when the owner asks for it.

## Testing

- **Import** (integration): the three values are stored on every record of a row, split parts included; an invalid value is `invalid_measurement`; the 35-column header is `header_mismatch`.
- **Records API**: the item carries `outlierFlag`.
- **Species search**: `outliers=true` keeps only species with a visible flagged record. A flagged record on an invisible trait or on an invisible record does not count.
- **Export**: the column is present and filled.
- **Web**: the badge with its reason, the drawer row, and the checkbox round-tripping `?outliers=true`.
- **E2E**: grep every spec for the labels touched.
