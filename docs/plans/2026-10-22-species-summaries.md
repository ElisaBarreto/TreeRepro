# Species summaries (issue #289) Implementation Plan

**Goal:** RFC-77 computed in the API, for one species or for all, and `verify:summaries` against the owner's files.

**Spec:** `docs/specs/2026-10-22-species-summaries.md`. **Epic:** #286.

## Tasks

1. **RFC-77** and the RFC index row.
2. **Failing integration tests**, one per rule (RFC-77 R4–R7), importing small v1 CSVs; plus platform records through `createRecord`.
3. **`continuousSummaries` and `categoricalSummaries`**, one SQL statement each; `speciesTraitStates` in TypeScript.
4. **`verify:summaries`**: a streaming CSV reader, a comparator (unit-tested), a CLI and a package script.
5. **Docs:** the handbook command entry.
6. **Verify**, run CodeRabbit, open the PR. After the reload: run `verify:summaries --trees-only` on production data and attach the result to #289.
