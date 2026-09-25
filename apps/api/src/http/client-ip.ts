import type { Context } from 'hono';
import type { AppEnv } from './env.ts';

/** @rfc RFC-22 R12 */
export const UNKNOWN_IP = 'unknown';

/** Caddy sets X-Forwarded-For to the resolved client alone (CF-Connecting-IP from Cloudflare peers). @rfc RFC-22 R12 */
export function clientIp(c: Context<AppEnv>): string {
  const last = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
  return last || UNKNOWN_IP;
}

/** @rfc RFC-22 R4 */
export function userAgent(c: Context<AppEnv>): string {
  return (c.req.header('user-agent') ?? '').slice(0, 512);
}
