// TEST-ONLY type augmentation. This file lives under `apps/api/test/`, which
// is included by `apps/api/tsconfig.json` (used by `pnpm typecheck` and
// Vitest) but NOT by `apps/api/tsconfig.build.json` (`include: ["src"]`), so
// it never reaches the production build. Application code in `src/` must
// keep treating `Response#json()` / `Request#json()` as `Promise<unknown>`
// and narrow/validate the result (e.g. with a Zod schema) before use.
//
// `apps/api/tsconfig.json` intentionally omits the "dom" lib: the API is a
// server process; it never runs in a browser. Without it, `@types/node` types the Fetch
// API's `Response`/`Request` bodies from `undici-types`, whose `json()` method
// returns `Promise<unknown>` instead of the `Promise<any>` that `lib.dom.d.ts`
// (and the Fetch spec) uses. That forces an explicit cast at every call site,
// including `hono`'s `app.request(...)` test helper — used verbatim by this
// package's test suites. This restores the `lib.dom.d.ts` signature, scoped to
// tests only, by augmenting the same global `Response`/`Request` interfaces
// `@types/node` already declares.
export {};

declare global {
  interface Response {
    // biome-ignore lint/suspicious/noExplicitAny: matches lib.dom.d.ts's Body#json signature.
    json(): Promise<any>;
  }
  interface Request {
    // biome-ignore lint/suspicious/noExplicitAny: matches lib.dom.d.ts's Body#json signature.
    json(): Promise<any>;
  }
}
