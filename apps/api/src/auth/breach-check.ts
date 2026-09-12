import { createHash } from 'node:crypto';
import type { Logger } from '../logger.ts';

/** @rfc RFC-21 R3 */
export interface PasswordBreachChecker {
  isBreached(password: string): Promise<boolean>;
}

/** @rfc RFC-21 R3 */
export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/** @rfc RFC-21 R3 */
export const HIBP_TIMEOUT_MS = 2000;

export interface HibpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: Logger;
}

/** @rfc RFC-21 R3 */
export function createHibpChecker(options: HibpOptions = {}): PasswordBreachChecker {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? HIBP_TIMEOUT_MS;
  return {
    async isBreached(password) {
      const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
      const prefix = digest.slice(0, 5);
      const suffix = digest.slice(5);
      try {
        const res = await doFetch(`${HIBP_RANGE_URL}${prefix}`, {
          headers: { 'Add-Padding': 'true', 'User-Agent': 'TreeRepro' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          options.logger?.warn({ status: res.status }, 'breach check skipped');
          return false;
        }
        const body = await res.text();
        for (const line of body.split('\n')) {
          const [candidate, count] = line.trim().split(':');
          if (candidate === suffix && Number(count) > 0) return true;
        }
        return false;
      } catch (err) {
        options.logger?.warn({ err: { name: (err as Error).name } }, 'breach check skipped');
        return false;
      }
    },
  };
}
