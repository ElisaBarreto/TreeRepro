import type { Context, MiddlewareHandler } from 'hono';
import { RATE_LIMITS, type RateLimiter, type RateLimitRule } from '../../auth/rate-limit.ts';
import { getPii } from '../../security/pii.ts';
import { clientIp } from '../client-ip.ts';
import type { AppEnv } from '../env.ts';
import { RateLimitedError } from '../errors.ts';

export interface RouteRateLimit {
  scope: string;
  rule: RateLimitRule;
  /** `null` skips this limit for the request. */
  key: (c: Context<AppEnv>) => Promise<string | null> | string | null;
}

/** Blind index of the client IP, so keys carry no PII. @rfc RFC-24 R7 */
export function ipKey(c: Context<AppEnv>): string {
  return getPii().blindIndex(clientIp(c));
}

/** Reads `email` from the raw JSON body before validation. @rfc RFC-24 R5, R7 */
export async function emailIpKey(c: Context<AppEnv>): Promise<string | null> {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
  const email =
    body && typeof body === 'object' && typeof body.email === 'string' ? body.email : null;
  if (!email) return null;
  return `${getPii().blindIndex(email)}:${ipKey(c)}`;
}

/** @rfc RFC-24 R1, R2, R5 */
export function rateLimit(
  limiter: RateLimiter,
  limits: RouteRateLimit[],
  onLimited?: (c: Context<AppEnv>) => Promise<void>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    for (const limit of limits) {
      const key = await limit.key(c);
      if (key === null) continue;
      const decision = await limiter.hit(limit.scope, key, limit.rule);
      if (!decision.allowed) {
        await onLimited?.(c);
        throw new RateLimitedError(decision.retryAfterSeconds);
      }
    }
    await next();
  };
}

/**
 * @rfc RFC-24 R4
 * @rfc RFC-82 R9
 */
export function globalRateLimit(limiter: RateLimiter): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.path.startsWith('/api/health')) return next();
    const apiKey = c.get('apiKey');
    const session = c.get('session');
    const decision = apiKey
      ? await limiter.hit('global:api_key', apiKey.id, RATE_LIMITS.apiKey)
      : session
        ? await limiter.hit('global:session', session.id, RATE_LIMITS.globalSession)
        : await limiter.hit('global:ip', ipKey(c), RATE_LIMITS.globalIp);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
    await next();
  };
}
