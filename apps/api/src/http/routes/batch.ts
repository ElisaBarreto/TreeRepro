import { type BatchOp, type BatchResult, batchBodySchema } from '@treerepro/contracts';
import { type Context, Hono } from 'hono';
import type { AuthContext } from '../../auth/context.ts';
import { RATE_LIMITS } from '../../auth/rate-limit.ts';
import { batchDispatch } from '../batch-dispatch.ts';
import type { AppEnv } from '../env.ts';
import { errorBody, RateLimitedError } from '../errors.ts';
import { requireApiKey } from '../middleware/session.ts';
import { SELF_SERVICE_ROUTES } from '../self-service-routes.ts';
import { validate } from '../validate.ts';

// Any host works: the URL only carries the path to the same application.
const BASE = 'http://batch.internal';
const FORWARDED = ['authorization', 'user-agent', 'x-forwarded-for'] as const;

const SELF_SERVICE = SELF_SERVICE_ROUTES.map((route) => {
  const [method, path] = route.split(' ') as [string, string];
  return { method, pattern: new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`) };
});

/**
 * Why an operation may not run, or the normalised URL it runs at.
 * @rfc RFC-82 R12
 */
export function batchRefusal(
  op: BatchOp,
): { reason: string; field: 'path' | 'body' } | { url: URL } {
  if (!op.path.startsWith('/api/')) return { reason: 'Path must start with /api/', field: 'path' };
  // Resolves dot segments (also percent-encoded ones); what is checked is what runs.
  const url = new URL(op.path, BASE);
  // Hono routes on the `decodeURI` form (`/api/b%61tch` reaches `/api/batch`),
  // so that is the form checked; a malformed escape is refused outright.
  let path: string;
  try {
    path = decodeURI(url.pathname);
  } catch {
    return { reason: 'Path has a malformed escape', field: 'path' };
  }
  if (url.origin !== BASE || !path.startsWith('/api/'))
    return { reason: 'Path must stay under /api/', field: 'path' };
  if (path === '/api/batch' || path.startsWith('/api/batch/'))
    return { reason: 'A batch cannot contain a batch', field: 'path' };
  if (SELF_SERVICE.some((r) => r.method === op.method && r.pattern.test(path)))
    return { reason: 'Account routes need a session', field: 'path' };
  if (op.method === 'GET' && op.body !== undefined)
    return { reason: 'A GET operation takes no body', field: 'body' };
  return { url };
}

async function run(
  c: Context<AppEnv>,
  dispatch: (request: Request) => Promise<Response>,
  op: BatchOp,
): Promise<BatchResult> {
  const ref = op.ref ?? null;
  const checked = batchRefusal(op);
  if ('reason' in checked) {
    const body = errorBody('VALIDATION_FAILED', checked.reason, [
      { path: checked.field, message: checked.reason },
    ]);
    return { ref, status: 400, body };
  }
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  const init: RequestInit = { method: op.method, headers };
  if (op.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(op.body);
  }
  const res = await batchDispatch.run(true, () => dispatch(new Request(checked.url, init)));
  if (/^application\/json\b/i.test(res.headers.get('content-type') ?? '')) {
    return { ref, status: res.status, body: await res.json() };
  }
  // Drained, not cancelled: cancelling a `Readable.toWeb` stream (the dataset
  // ZIP, RFC-66) before its first chunk throws an uncaught exception in Node's
  // adapter. Draining costs what the same single call would.
  await res.body?.pipeTo(new WritableStream());
  return { ref, status: res.status, body: null };
}

/**
 * `dispatch` is the root application's `fetch`, so each operation passes every
 * middleware and route exactly as a single call does.
 * @rfc RFC-82 R10, R11, R13, R14
 */
export function batchRoutes(ctx: AuthContext, dispatch: (request: Request) => Promise<Response>) {
  return new Hono<AppEnv>().post(
    '/',
    requireApiKey,
    validate('json', batchBodySchema),
    async (c) => {
      const { ops } = c.req.valid('json');
      const apiKey = c.get('apiKey');
      // `globalRateLimit` already charged this request one unit: it is the first operation.
      if (apiKey && ops.length > 1) {
        const decision = await ctx.limiter.hit(
          'global:api_key',
          apiKey.id,
          RATE_LIMITS.apiKey,
          ops.length - 1,
        );
        if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
      }
      const results: BatchResult[] = [];
      for (const op of ops) results.push(await run(c, dispatch, op));
      const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
      return c.json({ data: { summary: { ok, failed: results.length - ok }, results } });
    },
  );
}
