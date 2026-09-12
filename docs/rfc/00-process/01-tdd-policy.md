# RFC-01 — TDD policy

| Field | Value |
|---|---|
| Status | draft |
| Category | process |
| Supersedes | — |

## Context

Tests are the executable form of the RFCs. Writing them first keeps rules explicit and prevents untested code from existing.

## Rules

- **R1** No production code is written without a failing test that demands it. Cycle: red → green → refactor.
- **R2** Test levels, fastest first: unit (pure functions, no I/O), integration (real PostgreSQL and Redis via testcontainers), API (full Hono route through `app.request()`), security meta-tests (repository-wide invariants), end-to-end (Playwright in a browser). Frontend components are tested with Testing Library against a mocked API.
- **R3** Databases are never mocked. Integration and API tests run against ephemeral PostgreSQL 18 and Redis 8 containers with migrations applied.
- **R4** Each integration test is isolated: it runs inside a transaction that is rolled back, or it creates and removes its own state. Tests never depend on ordering or on shared seed data.
- **R5** `pnpm test` must pass before a commit; CI blocks merges on any failure.
- **R6** Every API route has negative tests: unauthenticated → 401, missing permission → 403, unknown body field → 400, invalid `Origin` on a mutation → 403. (401/403 for sessions and permissions apply once RFC-22 and RFC-32 exist.)
- **R7** Test files sit next to the code they test: `foo.ts` → `foo.test.ts` (unit) or `foo.integration.test.ts` (needs containers).
- **R8** Coverage percentage is not a goal. Every RFC rule with observable behavior has at least one test naming it (RFC-00 R5).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
