# WCVP regions (issue #291) Implementation Plan

**Goal:** RFC-78: the WCVP v15 accepted species, regions and native distribution in three tables, loaded by `import:wcvp`, and the matching view #292 uses.

**Spec:** `docs/specs/2026-10-23-wcvp-regions.md`. **Epic:** #286.

## Tasks

1. **RFC-78** and the RFC index row.
2. **Failing integration tests** in `apps/api/src/dataset/wcvp.integration.test.ts`, one per rule (RFC-78 R2–R6).
3. **Schema and migration** `wcvp_regions`: the three tables, the view, `TRUNCATE` granted to `treerepro_app`.
4. **`importWcvp`** in `apps/api/src/dataset/wcvp.ts`; the CLI `apps/api/src/cli/import-wcvp.ts` and the package script.
5. **Docs:** the handbook command entry and the runbook in `docs/gotchas/import.md`.
6. **Verify**: lint, typecheck, `rfc:check`, the API suite; load the real v15 files in a scratch database and report the counts and the time. Run CodeRabbit, open the PR.
