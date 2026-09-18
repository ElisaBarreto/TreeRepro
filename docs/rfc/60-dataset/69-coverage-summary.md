# RFC-69 — Coverage summary

| Field | Value |
|---|---|
| Status | accepted |
| Category | dataset |
| Supersedes | — |

## Context

Lists that filter or sort by "has data for this trait" cannot aggregate eight million records per request; this table is the maintained answer.

## Rules

- **R1** Table `species_trait_coverage(species_id uuid references species restrict, trait_id uuid references traits restrict, record_count integer not null, harmonised_count integer not null, first_record_at timestamptz not null, last_record_at timestamptz not null; primary key (species_id, trait_id); index (trait_id, species_id))`. One row per species × trait with at least one record. `species.trait_count integer not null default 0` is the number of such rows for the species (RFC-60 R1 amended). The column is visibility-blind by design: being denormalised it cannot be per-viewer, so it counts every coverage row, including rows on traits a curator has deactivated (RFC-33 R2). The filters and the completeness order of RFC-60 R6 do apply species and trait visibility (R4), so the two can disagree for a viewer who cannot see every trait — a species whose only record in a category is on an inactive trait is listed by `categoryKey=…&traitData=missing` while the trait count shown beside it still includes that trait, and the completeness order ranks it accordingly. This is intended: the count is a coarse guide, not a metric shown to contributors (`docs/specs/2026-09-17-browsing-design.md` §2).
- **R2** Maintenance: the statement trigger on `trait_records` insert (the one that maintains RFC-61 R4's counters) also upserts `species_trait_coverage` from the inserted rows (`on conflict (species_id, trait_id) do update set record_count = record_count + excluded.record_count, harmonised_count = …, last_record_at = greatest(…)`) and increments `species.trait_count` by the number of pairs newly inserted. Records are append-only (RFC-63 R4), so nothing ever decrements. Withdrawn records still count: coverage answers "is there a record", not "is there a good record".
- **R3** The migration backfills both in one statement each, the table from `trait_records` and the column from the table. The table first: `insert into species_trait_coverage … select species_id, trait_id, count(*), count(*) filter (where harmonisation = 'harmonised'), min(created_at), max(created_at) from trait_records group by 1, 2 on conflict do nothing`. Then the column, from the table that statement has just filled: `update species s set trait_count = c.n from (select species_id, count(*) as n from species_trait_coverage group by 1) c where s.id = c.species_id` — one grouped pass joined to `species`, not a correlated `count(*)` per species row; a species with no coverage row matches no group and keeps the column's default of `0`. The `treerepro_app` role gets `SELECT` only on the table. The trigger function (`trait_records_reference_usage()`, migration 0015, plain `plpgsql` today) becomes `SECURITY DEFINER` with `SET search_path = public, pg_temp` (the `audit_log_purge` pattern of migration 0007, with `pg_temp` named explicitly and **last**: unless the temporary schema is listed, PostgreSQL searches it *before* every listed schema for relation names, so a caller holding `TEMPORARY` — which `treerepro_app` does, through the default `PUBLIC` grant — could create a temporary table shadowing one this body reads and have a rule or trigger on it execute as the migrator; naming `pg_temp` after `public` leaves it nothing to shadow): it is owned by the migrator role that owns the tables, so the app role's inserts into `trait_records` can maintain a table the app role only reads. The function keeps its name (renaming would need `DROP TRIGGER` / `CREATE TRIGGER`).
- **R4** The table is read by: species filters and order (RFC-60 R6 amended), the missing-traits mode of the trait page (RFC-62 R8), the dashboard (RFC-72) and the coverage metrics (R5–R7, plan 11c). Visibility (RFC-33) is applied by joining `species` and `traits` and filtering on their `active` flags; the table itself has no flags.

## Open questions

Coverage metrics — headline tiles, per-category rollups and the "Top gaps" list — are R5–R7 of this RFC; they are specified in `docs/specs/2026-09-17-workspace-design.md` §5 and land with plan 11c, not here.

## Changelog

- 2026-09-18 — created.
- 2026-09-18 — accepted (R1–R4; R5–R7 are deferred to plan 11c).
- 2026-09-18 — R1: the visibility-blindness of `species.trait_count`, and its divergence from the RFC-60 R6 filters, stated explicitly.
- 2026-09-18 — R3: the pinned `search_path` names `pg_temp` explicitly and last (`public, pg_temp`). Correction, not a design change: `SET search_path = public` leaves the temporary schema searched first, which is the privilege-escalation foothold the final review of plan 10a found in a `SECURITY DEFINER` function that now fires on every `trait_records` insert. Migration 0007's `audit_log_purge()` still carries the uncorrected form (RFC-42 R2) and needs its own migration.
