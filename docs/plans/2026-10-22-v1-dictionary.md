# The v1 trait dictionary (issue #287) Implementation Plan

**Goal:** the committed dictionary is the owner's v1 file; `seed:traits` reads its header; `import:records --replace --sync-dictionary` makes the database's dictionary equal to it inside the replace transaction.

**Spec:** `docs/specs/2026-10-22-v1-dictionary.md` (D1–D5). **Epic:** #286.

## Global constraints

- RFC first, then a failing test, then code. No database mocks. Every new export carries `@rfc`.
- Run every check in the verify container (`docs/gotchas`, no Node on the host).
- `syncDictionary` runs only inside `importRecords`'s transaction, after `resetDataset`.

## Tasks

1. **RFCs.**
   - RFC-62 R2: the v1 header, checked before COPY.
   - RFC-62 R3: the R9 exception.
   - New RFC-62 R9: the sync.
   - RFC-64 R1: `--sync-dictionary`; R12: the sync runs after the wipe.
   - Changelogs.
2. **Seed header.** Tests: the old header is refused, and the v1 header loads. Code in `apps/api/src/dataset/seed.ts`: rename the staging columns to the v1 names and check the header names before COPY; keep the first spelling of a level repeated in another case. Replace `apps/api/seed/trait-dictionary.csv` with the owner's file. Fix the `whole plant` test in `import.integration.test.ts` and any seed test that names v0 columns.
3. **`syncDictionary(tx, csvPath)`** in `seed.ts`, sharing the staging step with `seedDictionary`. Tests in `reset.integration.test.ts` (isolated database): removed trait, retyped trait, removed and reordered level, unused category, rollback on failure.
4. **Import and CLI.**
   - `ImportInput.syncDictionary`, refused without `replace`, called after `resetDataset`.
   - `--sync-dictionary` in `import-records-args.ts`, a usage error without `--replace`, with unit tests.
   - The `Dictionary:` report line in the CLI.
5. **Docs.**
   - The handbook's `import:records` and `seed:traits` entries.
   - The `docs/gotchas/import.md` runbook (step 4 passes `--sync-dictionary`).
   - The `docs/gotchas/dataset.md` seed note.
6. **Verify** (lint, typecheck, `rfc:check`, test), run CodeRabbit locally, then open the PR (`Closes #287`).
