# RFC-62 — Trait dictionary

| Field | Value |
|---|---|
| Status | accepted |
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
- **R5** `GET /api/traits` (`dataset.read`) returns the whole dictionary: categories by `sort_order`, each with its traits by `key`, each with its levels by `sort_order` then `key`; inactive traits and levels are included with `active: false`. Shape: `[{ key, label, traits: [{ id, key, valueType, unit, description, active, levels: [{ id, key, sortOrder, active }] }] }]`. The response is not cacheable beyond the request (the dictionary is editable, R6).
- **R6** Writes require `traits.manage`, answer the trait entry of R5 (201 on create, 200 on update) and record `traits.created` or `traits.updated` in their transaction (RFC-41 R5) with `target_type = 'traits'`, `target_id` the trait id, `metadata.fields` on update and `metadata.levelId` when a level is concerned. `POST /api/traits` `{ key, categoryKey, valueType, unit?, description? }` (`key` 1–200 characters trimmed, `unit` 1–32, `description` up to 2,000; 409 `TRAIT_KEY_TAKEN`; an unknown category answers 400 `VALIDATION_FAILED` with path `categoryKey`). `PATCH /api/traits/:id` `{ categoryKey?, description?, active? }` (404 `TRAIT_NOT_FOUND`) — `key`, `valueType` and `unit` are immutable after creation: the import matches by key and a unit change would silently change the meaning of stored numbers. `POST /api/traits/:id/levels` `{ key, sortOrder? }` adds a level (default `sortOrder` = the trait's highest + 1; 409 `LEVEL_KEY_TAKEN` on `lower(key)` within the trait) and records `traits.updated` with `fields: ['levels']`. `PATCH /api/traits/:id/levels/:levelId` `{ key?, sortOrder?, active? }` (404 `LEVEL_NOT_FOUND`, also when the level belongs to another trait; 409 `LEVEL_KEY_TAKEN`). Renaming a level keeps every record's `level_id` and `value_text`. A `PATCH` with no field answers 400 `VALIDATION_FAILED`; one that changes nothing records nothing. `seed:traits` (R2) re-inserts a level whose key was renamed unless the repository CSV is changed too: a rename made in the UI is also made in `apps/api/seed/trait-dictionary.csv`.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
- 2026-09-13 — R5 amended (level sortOrder, no HTTP cache), R6 added: dictionary writes and their audit (plan 07).
