# Species page summaries (issue #290) Implementation Plan

**Spec:** `docs/specs/2026-10-23-species-page-summaries.md`. **Epic:** #286.

1. RFC-63 R10.
2. Contract: in `traitSummarySchema`, remove `numeric`, add `continuous` and `categorical`, and add `nSources` and `shareOfRecords` to levels. Update the contract tests.
3. API: `speciesTraitSummary` calls the RFC-77 functions for the species. Replace the per-field-means tests in `summary.integration.test.ts` with route-level summary tests.
4. Web: the `TraitCard` lines and badge; fixtures; tests. Grep the e2e specs for the changed texts.
5. API guide, changelog and openapi hash.
6. Verify (lint, typecheck, `rfc:check`, API and web tests), CodeRabbit, PR.
