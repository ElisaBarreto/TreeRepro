# Weekly snapshot (issue #292) Implementation Plan

**Spec:** `docs/specs/2026-10-23-weekly-snapshot.md`. **Epic:** #286.

1. RFC-78 R7–R12 and RFC-74 R1.
2. Schema and migration:
   - `region_completeness`, `region_continuous`, `region_categorical` and `region_snapshot`;
   - the `job_runs` kind check gains `snapshot`.
3. Failing integration tests in `apps/api/src/jobs/snapshot.integration.test.ts`.
4. `apps/api/src/jobs/snapshot.ts`: `runSnapshot`, `isSnapshotDue` and `startSnapshotTimer`. Export `countedRecordsSql` from `species-summary.ts`.
5. CLI `build:snapshot` and its package script. Wire the timer in `server.ts`.
6. Docs:
   - the handbook entry;
   - the import runbook (run `build:snapshot` after a reload or a WCVP load).
7. Verify against the owner's `region_*_trees.csv` on the dev database, then CodeRabbit, then the PR.
