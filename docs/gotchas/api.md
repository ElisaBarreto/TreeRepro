# External API (RFC-82)

## A dependency bump can fail the openapi-sha256 lock with no route change
**Symptom:** `pnpm test` fails on `RFC-82 R19 the guide pins the generated reference` right after bumping a dependency — nothing in `apps/api/src/http/route-catalog.ts` or any route changed.
**Cause:** The OpenAPI reference is generated with Zod's `z.toJSONSchema` (`apps/api/src/http/openapi.ts`). A Zod upgrade, or any other dependency change that alters how a schema serialises to JSON Schema, can change the generated document's bytes — and therefore its SHA-256 — with the API surface itself unchanged.
**Fix:** Regenerate the hash the way the failing test does (it prints the expected value), set it as `docs/api/guide.md`'s first line, and add a changelog entry that says so — "no API change; reference regenerated after a Zod upgrade" — ending with `(openapi <first 12 hex of the new hash>)` (CLAUDE.md rule 10, RFC-82 R19).
