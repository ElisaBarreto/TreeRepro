import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import { requestLogger } from './request-logger.ts';

describe('RFC-10 R12 requestLogger', () => {
  it('sets a child logger whose every line carries the request id', async () => {
    const { logger, lines } = captureLogger();
    const app = new Hono<AppEnv>();
    app.use(requestId());
    app.use(requestLogger(logger));
    app.get('/x', (c) => {
      const log = c.get('logger');
      log.info('one');
      log.warn({ detail: true }, 'two');
      return c.text('ok');
    });
    await app.request('/x', { headers: { 'x-request-id': 'rid-1' } });
    await app.request('/x', { headers: { 'x-request-id': 'rid-2' } });
    const ids = lines.map((l) => [
      (l as { msg: string }).msg,
      (l as { requestId: string }).requestId,
    ]);
    expect(ids).toEqual([
      ['one', 'rid-1'],
      ['two', 'rid-1'],
      ['one', 'rid-2'],
      ['two', 'rid-2'],
    ]);
  });

  it('inherits the base logger level and redaction', async () => {
    const { logger, lines } = captureLogger('warn');
    const app = new Hono<AppEnv>();
    app.use(requestId());
    app.use(requestLogger(logger));
    app.get('/x', (c) => {
      c.get('logger').info('dropped');
      c.get('logger').warn({ email: 'a@b.example' }, 'kept');
      return c.text('ok');
    });
    await app.request('/x');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'kept', email: '[REDACTED]' });
  });
});
