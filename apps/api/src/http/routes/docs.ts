import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireApiKey } from '../middleware/session.ts';
import { buildOpenApi, type RouteEntry } from '../openapi.ts';

/**
 * `<repo>/docs/api/guide.md`, resolved from this file's own location so it
 * works both from `apps/api/src/http/routes/` (dev, run with `tsx`) and
 * `apps/api/dist/http/routes/` (the production image, which ships `docs/api`
 * alongside `apps/api`).
 * @rfc RFC-82 R20
 */
export function defaultGuidePath(): string {
  return fileURLToPath(new URL('../../../../../docs/api/guide.md', import.meta.url));
}

/**
 * `GET /` answers the hand-written guide as Markdown; `GET /openapi.json`
 * answers the OpenAPI 3.1 reference generated from the mounted routes. Both
 * are API-key routes (RFC-32 R5): without a key, or with a cookie session
 * only, `requireApiKey` answers 401 `AUTH_UNAUTHENTICATED`. The guide is read
 * from disk once and cached; a failed read (the file briefly missing, a
 * transient I/O error) is never cached, so the next request retries the read
 * instead of repeating the same failure forever. The reference is built once
 * and memoised.
 * @rfc RFC-82 R20
 */
export function docsRoutes(routes: () => readonly RouteEntry[], guidePath: string) {
  let guide: Promise<string> | undefined;
  let reference: Record<string, unknown> | undefined;
  return new Hono<AppEnv>()
    .get('/', requireApiKey, async (c) => {
      guide ??= readFile(guidePath, 'utf8').catch((err: unknown) => {
        guide = undefined;
        throw err;
      });
      return c.body(await guide, 200, { 'content-type': 'text/markdown; charset=utf-8' });
    })
    .get('/openapi.json', requireApiKey, (c) => {
      reference ??= buildOpenApi(routes());
      return c.json(reference);
    });
}
