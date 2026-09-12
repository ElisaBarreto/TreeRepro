// `apps/api/tsconfig.json` intentionally omits the "dom" lib (RFC-10 R2: this
// package never runs in a browser). Without it, `@types/node` types the Fetch
// API's `Response`/`Request` bodies from `undici-types`, whose `json()` method
// returns `Promise<unknown>` instead of the `Promise<any>` that `lib.dom.d.ts`
// (and the Fetch spec) uses. That forces an explicit cast at every call site,
// including `hono`'s `app.request(...)` test helper. This restores the
// `lib.dom.d.ts` signature by augmenting the same global `Response`/`Request`
// interfaces `@types/node` already declares.
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
