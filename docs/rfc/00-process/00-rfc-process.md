# RFC-00 — RFC process

| Field | Value |
|---|---|
| Status | accepted |
| Category | process |
| Supersedes | — |

## Context

Business rules must have one home that code, tests and reviewers can point at. That home is an RFC. Code implements RFCs; it never defines rules on its own.

## Rules

- **R1** Every business rule lives in exactly one RFC file at `docs/rfc/<category>/<NN>-<slug>.md`. `NN` is a unique two-digit number; categories own ranges of ten (see `docs/rfc/README.md`).
- **R2** An RFC starts with a header table (Status, Category, Supersedes) and has the sections Context, Rules, Data model (optional), API (optional), Open questions, Changelog. Status is one of `draft`, `accepted`, `superseded`.
- **R3** Rules are list items of the form `- **Rn** text`, numbered from R1 without gaps at creation. Rule IDs are stable: a rule is never renumbered. A retired rule keeps its number and is rewritten as `- **Rn** (retired) reason`.
- **R4** Every exported symbol in `apps/*/src/**` and `packages/*/src/**` carries a JSDoc block immediately above it containing `@rfc RFC-NN` optionally followed by rule references (`R3`, `R1-R4`, `R2, R5`). Type-only exports (`export type`, `export interface`), re-exports (`export { … } from`, `export * from`) and generated files (`*.gen.ts`) are exempt. `tools/rfc-lint` enforces this and fails when the RFC or rule does not exist.
- **R5** Tests name the rule they verify: `describe('RFC-NN Rn …')` or `it('RFC-NN Rn …')`.
- **R6** Order of change: write or amend the RFC (status `draft`) → write the failing test → write the code → set status `accepted` when merged. Code without an RFC is a defect.
- **R7** RFCs, code, comments, commits and UI text are written in English.
- **R8** When an RFC replaces another, the new one lists the old in `Supersedes` and the old one is set to `superseded` with a pointer to the new one. Files are never deleted.

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
