import { describe, expect, it } from 'vitest';
import { captureLogger } from '../test/helpers/logger.ts';

describe('RFC-02 R7 log redaction', () => {
  it('redacts sensitive keys at the top level and one level deep', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        password: 'p',
        passwordHash: 'h',
        token: 't',
        secret: 's',
        email: 'e',
        ip: '1.2.3.4',
        userAgent: 'ua',
        user: { email: 'e2', name: 'n', passwordHash: 'h2', id: 'keep' },
        err: new Error('boom'),
      },
      'hello',
    );
    const line = lines[0] as Record<string, unknown>;
    expect(line.password).toBe('[REDACTED]');
    expect(line.passwordHash).toBe('[REDACTED]');
    expect(line.token).toBe('[REDACTED]');
    expect(line.secret).toBe('[REDACTED]');
    expect(line.email).toBe('[REDACTED]');
    expect(line.ip).toBe('[REDACTED]');
    expect(line.userAgent).toBe('[REDACTED]');
    expect(line.user).toEqual({
      email: '[REDACTED]',
      name: '[REDACTED]',
      passwordHash: '[REDACTED]',
      id: 'keep',
    });
    expect((line.err as { message: string }).message).toBe('boom');
    expect(line.msg).toBe('hello');
  });

  it('redacts cookie, authorization and set-cookie headers', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      req: { headers: { cookie: 'a=1', authorization: 'Bearer x', accept: 'json' } },
      res: { headers: { 'set-cookie': 'a=1' } },
    });
    const line = lines[0] as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, string> };
    };
    expect(line.req.headers).toEqual({
      cookie: '[REDACTED]',
      authorization: '[REDACTED]',
      accept: 'json',
    });
    expect(line.res.headers).toEqual({ 'set-cookie': '[REDACTED]' });
  });

  it('redacts the IP-bearing proxy headers and socket address of a logged request', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      req: {
        ip: '203.0.113.7',
        remoteAddress: '203.0.113.7',
        headers: {
          'x-forwarded-for': '203.0.113.7, 10.0.0.1',
          'x-real-ip': '203.0.113.7',
          forwarded: 'for=203.0.113.7',
          host: 'treerepro.example',
        },
      },
      remoteAddress: '203.0.113.7',
    });
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain('203.0.113.7');
    expect(text).not.toContain('10.0.0.1');
    const line = lines[0] as { req: { headers: Record<string, string> } };
    expect(line.req.headers.host).toBe('treerepro.example');
  });

  it('honours the configured level and omits pid/hostname', () => {
    const { logger, lines } = captureLogger('warn');
    logger.info('dropped');
    logger.warn('kept');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty('pid');
    expect(lines[0]).not.toHaveProperty('hostname');
    expect(lines[0]).toHaveProperty('time');
  });
});
