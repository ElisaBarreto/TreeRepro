import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import { createHibpChecker, HIBP_RANGE_URL } from './breach-check.ts';

const PASSWORD = 'password12345';
const SHA1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();
const PREFIX = SHA1.slice(0, 5);
const SUFFIX = SHA1.slice(5);

function stubFetch(body: string, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return new Response(body, { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('RFC-21 R3 HIBP k-anonymity check', () => {
  it('sends only the five-character prefix with Add-Padding and matches the suffix', async () => {
    const { fetchFn, calls } = stubFetch(
      `0018A45C4D1DEF81644B54AB7F969B88D65:0\n${SUFFIX}:42\nABCDEF:1\n`,
    );
    const checker = createHibpChecker({ fetch: fetchFn });
    expect(await checker.isBreached(PASSWORD)).toBe(true);
    expect(calls[0]?.url).toBe(`${HIBP_RANGE_URL}${PREFIX}`);
    expect(calls[0]?.url).not.toContain(SUFFIX);
    expect(calls[0]?.headers['add-padding']).toBe('true');
  });

  it('ignores padded entries (count 0) and unknown suffixes', async () => {
    const { fetchFn } = stubFetch(`${SUFFIX}:0\nABCDEF:3\n`);
    expect(await createHibpChecker({ fetch: fetchFn }).isBreached(PASSWORD)).toBe(false);
  });

  it('treats a non-2xx response, a network error and a timeout as not breached, logging without the password', async () => {
    const { logger, lines } = captureLogger();
    const { fetchFn } = stubFetch('', 503);
    expect(await createHibpChecker({ fetch: fetchFn, logger }).isBreached(PASSWORD)).toBe(false);
    const failing = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    expect(await createHibpChecker({ fetch: failing, logger }).isBreached(PASSWORD)).toBe(false);
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    expect(
      await createHibpChecker({ fetch: hanging, logger, timeoutMs: 20 }).isBreached(PASSWORD),
    ).toBe(false);
    expect(lines).toHaveLength(3);
    expect(JSON.stringify(lines)).not.toContain(PASSWORD);
    expect(JSON.stringify(lines)).not.toContain(SUFFIX);
  });
});
