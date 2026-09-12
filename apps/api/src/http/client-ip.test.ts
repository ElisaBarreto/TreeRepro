import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIp, UNKNOWN_IP, userAgent } from './client-ip.ts';
import type { AppEnv } from './env.ts';

async function probe(headers: Record<string, string>): Promise<{ ip: string; ua: string }> {
  const app = new Hono<AppEnv>().get('/', (c) => c.json({ ip: clientIp(c), ua: userAgent(c) }));
  return (await app.request('/', { headers })).json();
}

describe('RFC-22 R12 client IP', () => {
  it('takes the last X-Forwarded-For entry', async () => {
    expect((await probe({ 'x-forwarded-for': '198.51.100.9, 203.0.113.7' })).ip).toBe(
      '203.0.113.7',
    );
    expect((await probe({ 'x-forwarded-for': ' 203.0.113.7 ' })).ip).toBe('203.0.113.7');
  });

  it('is "unknown" without the header', async () => {
    expect((await probe({})).ip).toBe(UNKNOWN_IP);
    expect((await probe({ 'x-forwarded-for': '' })).ip).toBe(UNKNOWN_IP);
  });

  it('caps the user agent at 512 characters and defaults to empty', async () => {
    expect((await probe({ 'user-agent': 'x'.repeat(600) })).ua).toHaveLength(512);
    expect((await probe({})).ua).toBe('');
  });
});
