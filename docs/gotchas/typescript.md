# TypeScript

## `Response#json()` is `unknown` under Node's undici types
**Symptom:** Tests like `(await res.json()).error.code` fail typecheck.
**Cause:** `apps/api` has no `dom` lib (RFC-10 R2: it never runs in a browser), so `@types/node` types `Body#json()` — and therefore `Response#json()` / `Request#json()` — as `Promise<unknown>` instead of `lib.dom.d.ts`'s `Promise<any>`.
**Fix:** The test-only ambient file `apps/api/test/types/fetch.d.ts` widens it back to `Promise<any>` for the typecheck program (`apps/api/tsconfig.json` includes `test`), while `tsconfig.build.json` (only `src`) keeps production code strict. Application code must still narrow/validate `json()` results (Zod) rather than trust the widened type.

## TypeScript 7 is the native compiler
**Symptom:** No `tsserver` binary to point an editor or tool at.
**Cause:** `typescript@7.0.2` ships only `bin/tsc` (the native Go-based compiler); the old `tsserver.js` language service is gone.
**Fix:** Editors use their own native TypeScript support instead of spawning `tsserver`. All compiler options used in `packages/config/tsconfig.base.json` are accepted by the native compiler.
