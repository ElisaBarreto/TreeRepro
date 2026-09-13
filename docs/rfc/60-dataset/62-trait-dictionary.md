# RFC-62 — Trait dictionary

| Field | Value |
|---|---|
| Status | draft |
| Category | dataset |
| Supersedes | — |

## Context

Traits are a controlled vocabulary: about one hundred standard traits in thirteen categories, each categorical (a closed list of levels) or quantitative (a number in a fixed unit). The vocabulary is what makes filtering and comparison possible; a value outside it is pending harmonisation (RFC-63 R5), never free text.

## Rules

- **R1** Tables:
  - `trait_categories(key text primary key, label text, sort_order integer)`
  - `traits(id uuid default uuidv7(), key text unique, category_key text references trait_categories restrict, value_type text in ('categorical', 'quantitative'), unit text null, description text default '', active boolean default true, created_at timestamptz, created_by uuid null references users)`
  - `trait_levels(id uuid default uuidv7(), trait_id uuid references traits restrict, key text, sort_order integer default 0, active boolean default true, created_at timestamptz, created_by uuid null references users; unique (trait_id, lower(key)))`
- **R2** The vocabulary is versioned in the repository as `apps/api/seed/trait-dictionary.csv` with the columns `final_standard_trait, broad_category, trait_value_type, standard_unit, description, harmonised_levels` (levels separated by `;`). The command `seed:traits` loads it: it inserts the categories that are missing (label = key with underscores replaced by spaces and initial capitals; `sort_order` = position of first appearance), the traits that are missing (key, category, value type, unit or null, description) and the levels that are missing (`sort_order` = position in the list). It never updates, deactivates or deletes a row and may run any number of times. The keys are stored exactly as the file spells them.
- **R3** A trait or a level is never deleted. Retiring one sets `active = false`: it disappears from the choices offered for new records; records already pointing at it are unaffected. Plan 07 defines the routes that create, rename and retire traits and levels.
- **R4** A value matches a level when `lower(trim(value)) = lower(key)` for a level of that trait.
- **R5** `GET /api/traits` (`dataset.read`) returns the whole dictionary: categories by `sort_order`, each with its traits by `key`, each with its levels by `sort_order` then `key`; inactive traits and levels are included with `active: false`. Shape: `[{ key, label, traits: [{ id, key, valueType, unit, description, active, levels: [{ id, key, active }] }] }]`. The response carries `Cache-Control: private, max-age=300`.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
