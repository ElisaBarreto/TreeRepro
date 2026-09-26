# Node runtime

## Relative imports need explicit `.ts` extensions
**Symptom:** `ERR_MODULE_NOT_FOUND` at runtime for `./foo` while `tsc` is happy.
**Cause:** Node executes TypeScript source directly (type stripping) and resolves like ESM: no extension guessing.
**Fix:** Always write `./foo.ts` (or `.tsx`). `rewriteRelativeImportExtensions` turns them into `.js` in `dist/`.

## Only erasable TypeScript syntax
**Symptom:** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on start.
**Cause:** Type stripping cannot run `enum`, `namespace`, parameter properties or `import x = require()`.
**Fix:** Use `as const` objects instead of enums; plain constructor assignments. `erasableSyntaxOnly` in `tsconfig.base.json` flags it at typecheck time.

## `@treerepro/contracts` resolves to `dist/` unless the `development` condition is set
**Symptom:** `Cannot find module '.../packages/contracts/dist/index.js'` when running source.
**Cause:** Node refuses to type-strip files under `node_modules`, so the package exports built JS by default and source only under the `development` export condition.
**Fix:** Run source with `node --conditions=development …` (the `dev` and `db:migrate` scripts do; `rfc-lint` does not import contracts). Production runs `dist/` after `pnpm --filter @treerepro/contracts build`.

## `server.close()` waits for in-flight requests
**Symptom:** SIGTERM shutdown takes up to 10 s.
**Cause:** Node's `http.Server.close` waits for active requests before its callback fires (idle keep-alive sockets are closed automatically since Node 19, so those no longer block it).
**Fix:** `apps/api/src/server.ts` has an unref'd 10 s fallback that force-exits with code 1. Nothing to do unless a long-lived connection (e.g. a stream or upgrade) appears; in that case shorten the fallback or track and destroy the connection explicitly.

## Drizzle wraps driver errors
**Symptom:** `rejects.toThrow(/postgres message/)` fails even though PostgreSQL rejected the query.
**Cause:** Drizzle 0.45 throws `DrizzleQueryError` ("Failed query …") and puts the underlying `PostgresError` on `.cause`.
**Fix:** In tests use `unwrapDbError()` from `apps/api/test/helpers/db.ts`, which walks `.cause` to the root error. In application code inspect `error.cause` rather than matching on the top-level message.

## `@node-rs/argon2` is a native module
**Symptom:** `Cannot find module '@node-rs/argon2-<platform>'` after `pnpm install`, or a slow first test.
**Cause:** The package ships prebuilt binaries as optional dependencies per platform (`darwin-arm64`, `linux-x64-musl`, …); pnpm installs only the one matching the host. The lockfile lists them all, so the Alpine image resolves `linux-x64-musl` (or `linux-arm64-musl`). No build script runs.
**Fix:** Keep the lockfile committed; never add `--no-optional`. Each hash costs ~50 ms at the RFC-21 parameters — tests reuse one hash per password through `test/helpers/users.ts`.

## `Readable.toWeb` throws after a cancel
**Symptom:** A client that aborts a streamed download (or `res.body.cancel()` in a test) crashes the process: uncaught `TypeError: Invalid state: Controller is already closed` (`ERR_INVALID_STATE`) from `node:internal/webstreams/adapters` (issue #207).
**Cause:** `Readable.toWeb` puts the Node stream in flowing mode and enqueues each `data` chunk; a chunk already in flight when the web stream is cancelled is enqueued on the closed controller.
**Fix:** Pull through the source's async iterator in a `ReadableStream` of your own whose `cancel()` calls `nodeReadable.destroy()` (`datasetZip`, RFC-66 R5). Not `ReadableStream.from(nodeReadable)` alone: its cancel calls the iterator's `return()`, and on an iterator never read that skips the generator's cleanup, so the source stays open (issue #216: a batch cancelling the export unread held a pooled connection for good).
