import { errorEnvelopeSchema } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../test/helpers/logger.ts';
import { type AppDeps, BODY_LIMIT_BYTES, createApp } from './app.ts';
import { AppError } from './http/errors.ts';

const ORIGIN = 'http://localhost';

function build(overrides: Partial<AppDeps> = {}) {
  const { logger, lines } = captureLogger();
  const deps: AppDeps = {
    config: { appOrigin: ORIGIN },
    logger,
    health: { database: async () => true, redis: async () => true },
    ...overrides,
  };
  return { app: createApp(deps), lines };
}

describe('RFC-10 R10 health', () => {
  it('GET /api/health answers exactly {"ok":true}', async () => {
    const res = await build().app.request('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /api/health/ready is 200 when both checks pass and 503 otherwise', async () => {
    expect((await build().app.request('/api/health/ready')).status).toBe(200);
    const down = build({ health: { database: async () => true, redis: async () => false } });
    const res = await down.app.request('/api/health/ready');
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
    const throwing = build({
      health: {
        database: async () => {
          throw new Error('db down');
        },
        redis: async () => true,
      },
    });
    expect((await throwing.app.request('/api/health/ready')).status).toBe(503);
  });
});

describe('RFC-11 R8 unknown routes', () => {
  it('answer 404 with the error envelope', async () => {
    const res = await build().app.request('/api/does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('RFC-10 R12 request id', () => {
  it('sets X-Request-Id and echoes a provided one', async () => {
    const { app } = build();
    const generated = await app.request('/api/health');
    expect(generated.headers.get('x-request-id')).toMatch(/\S+/);
    const echoed = await app.request('/api/health', { headers: { 'x-request-id': 'abc-123' } });
    expect(echoed.headers.get('x-request-id')).toBe('abc-123');
  });
});

describe('RFC-02 R5 security headers', () => {
  it('are present on every response', async () => {
    const res = await build().app.request('/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('RFC-02 R4 body limit', () => {
  it('rejects bodies over 1 MiB with 413 REQUEST_TOO_LARGE', async () => {
    const { app } = build();
    // Routes added to the app are prefixed with the /api basePath automatically.
    app.post('/echo', async (c) => c.json({ length: (await c.req.text()).length }));
    const big = 'x'.repeat(BODY_LIMIT_BYTES + 1);
    const res = await app.request('/api/echo', {
      method: 'POST',
      body: big,
      headers: { origin: ORIGIN, 'content-length': String(big.length) },
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('REQUEST_TOO_LARGE');
    const ok = await app.request('/api/echo', {
      method: 'POST',
      body: 'small',
      headers: { origin: ORIGIN, 'content-length': '5' },
    });
    expect(ok.status).toBe(200);
  });
});

describe('RFC-02 R9 error handling is wired', () => {
  it('maps AppError and hides unexpected errors', async () => {
    const { app, lines } = build();
    app.get('/app-error', () => {
      throw new AppError('RATE_LIMITED', 'Slow down');
    });
    app.get('/boom', () => {
      throw new Error('internal detail');
    });
    expect((await app.request('/api/app-error')).status).toBe(429);
    const res = await app.request('/api/boom');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('internal detail');
    expect(lines.some((l) => (l as { msg: string }).msg === 'unhandled error')).toBe(true);
  });
});
