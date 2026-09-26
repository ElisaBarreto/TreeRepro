import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Redis } from '../redis/client.ts';

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 0 when allowed; otherwise seconds to wait, at least 1. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(scope: string, key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

const MINUTE = 60_000;
const QUARTER_HOUR = 15 * MINUTE;

// `tokenIp` is shared by `invite/accept` and `password/reset` (RFC-24 R3)
// and, unlike the other buckets, gets hit repeatedly by test suites that
// each provision their own users (the same tightrope `loginEmailIp` walks
// in apps/e2e/tests/global-setup.ts). Its limit reads from an env var so
// the E2E compose stack can widen it without changing the shipped default.
const TOKEN_IP_LIMIT = z.coerce
  .number()
  .int()
  .positive()
  .default(10)
  .parse(process.env.RATE_LIMIT_TOKEN_IP);

/**
 * @rfc RFC-24 R3
 * @rfc RFC-82 R2, R9
 */
export const RATE_LIMITS = {
  globalSession: { limit: 300, windowMs: MINUTE },
  globalIp: { limit: 100, windowMs: MINUTE },
  loginEmailIp: { limit: 5, windowMs: QUARTER_HOUR },
  loginIp: { limit: 20, windowMs: QUARTER_HOUR },
  loginTotp: { limit: 5, windowMs: QUARTER_HOUR },
  forgotEmailIp: { limit: 3, windowMs: QUARTER_HOUR },
  forgotIp: { limit: 10, windowMs: QUARTER_HOUR },
  tokenIp: { limit: TOKEN_IP_LIMIT, windowMs: QUARTER_HOUR },
  // The first non-auth bucket: `GET /api/taxonomy/match` reaches GBIF on the
  // platform's behalf, so it is limited per user (RFC-81 R4), opted into
  // explicitly by that route rather than applied globally.
  taxonomyMatchUser: { limit: 30, windowMs: MINUTE },
  // RFC-82 R9: scripts send far more than a person clicking.
  apiKey: { limit: 3000, windowMs: 10 * MINUTE },
  // RFC-82 R2: guards the TOTP code asked at key creation.
  apiKeyCreate: { limit: 5, windowMs: QUARTER_HOUR },
} as const satisfies Record<string, RateLimitRule>;

// KEYS[1] = sorted set; ARGV = now(ms), window(ms), limit, member.
// Returns {allowed(0|1), retryAfter(ms)}.
const HIT_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`;

/** @rfc RFC-24 R1, R2 */
export function createRateLimiter(redis: Redis, now: () => number = Date.now): RateLimiter {
  return {
    async hit(scope, key, rule) {
      const t = now();
      const member = `${t}-${randomBytes(4).toString('hex')}`;
      const result = (await redis.eval(
        HIT_SCRIPT,
        1,
        `rl:${scope}:${key}`,
        String(t),
        String(rule.windowMs),
        String(rule.limit),
        member,
      )) as [number, number];
      if (result[0] === 1) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(result[1] / 1000)) };
    },
  };
}
