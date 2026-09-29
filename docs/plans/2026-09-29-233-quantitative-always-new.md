# A continuous value is always a new record (issue #233) — Plan

**Goal:** D7 of `docs/plans/2026-09-29-value-fields.md`. A quantitative entry never matches or updates an existing record: it creates one unless it collides with the claim key, and a quantitative contest creates the record it contests with. Confirming a quantitative record is only ✓ Validate.

**Rules:** RFC-70 R3 (amended), RFC-63 R3 (claim key, unchanged), RFC-63 R14 (a quantitative contest is one record, unchanged).

## Tasks

1. **RFC.** RFC-70 R3: only a categorical entry is matched; a quantitative one creates a record unless it collides with the claim key; a quantitative contest creates its record; the web app's duplicate wording is "is already recorded — nothing was added". Changelog entry.
2. **Failing tests** (`apps/api/src/dataset/curation.integration.test.ts`). The quantitative contest whose value equals another record creates and stores a contest; six identical fields under another reference create a record. The #223 block ("a manual single value matches only a single or unspecified record") becomes "a quantitative entry is never matched": the same number as an existing record creates one, and an identical claim (same value and references) is a duplicate.
3. **Code** (`apps/api/src/dataset/curation.ts`). `matchingRecords` matches a level only; `createRecords` skips it for a quantitative value. The claim-key fallback already reports a collision in `duplicates`, and a quantitative contest that collided still contests nothing.
4. **Web** (`AddEntriesDialog`). A duplicate is no longer always the actor's own record — a claim-key collision can name another contributor's record under the same reference — so it reads "is already recorded — nothing was added". The "counted as your validation" line stays: only a categorical entry produces it now.

## Unchanged

- The API shape: `{ created, validated, duplicates }`; `validated` is empty for a quantitative entry. The route catalog and `docs/api/guide.md` describe neither the matching nor the answer's fields, so they do not change; the guide's changelog records the behaviour change (CLAUDE.md rule 10).
- The claim key has no author column: an identical claim is the same value, raw value and references. A personal observation reference belongs to one observer (RFC-61 R7), so two contributors' observations never collide.
- Categorical entries.
