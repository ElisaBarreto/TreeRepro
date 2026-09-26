import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { auditVia } from '../../audit/via.ts';
import { bearerToken, findUsableKey } from '../../auth/api-keys.ts';
import { RATE_LIMITS, type RateLimiter } from '../../auth/rate-limit.ts';
import type { SessionRecord, SessionStore } from '../../auth/sessions.ts';
import { findUserById } from '../../auth/users.ts';
import type { Db } from '../../db/client.ts';
import type { UserRow } from '../../db/schema/users.ts';
import type { AppEnv } from '../env.ts';
import { AppError, RateLimitedError } from '../errors.ts';
import { markGuard } from '../guards.ts';
import { ipKey } from './rate-limit.ts';

/** @rfc RFC-22 R5 */
export const SESSION_COOKIE = '__Host-session';
/** @rfc RFC-23 R6 */
export const MFA_COOKIE = '__Host-mfa';

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' } as const;

/** @rfc RFC-22 R5 */
export function setSessionCookie(c: Context<AppEnv>, rawId: string): void {
  setCookie(c, SESSION_COOKIE, rawId, COOKIE_OPTIONS);
}

/** @rfc RFC-22 R5 */
export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

/** @rfc RFC-23 R6 */
export function setMfaCookie(c: Context<AppEnv>, rawId: string): void {
  setCookie(c, MFA_COOKIE, rawId, COOKIE_OPTIONS);
}

/** @rfc RFC-23 R6 */
export function clearMfaCookie(c: Context<AppEnv>): void {
  deleteCookie(c, MFA_COOKIE, { path: '/', secure: true });
}

/** @rfc RFC-23 R6 */
export function readMfaCookie(c: Context<AppEnv>): string | undefined {
  return getCookie(c, MFA_COOKIE);
}

/**
 * Runs on every request: a valid cookie puts `session` and `user` on the
 * context; an invalid one is revoked and cleared. A header whose scheme is
 * `Bearer` authenticates independently of the cookie and never sets
 * `session`, so a key never reaches a self-service route (RFC-82 R6). Every
 * way such a header can fail to authenticate — it does not parse (RFC-82
 * R3), a cookie is also present (R4), or the key does not resolve (R3) —
 * first counts against the `global:ip` bucket before answering 401, so a
 * flood of bogus keys cannot skip rate limiting for free: each still costs a
 * hash and a database lookup, same as a real attempt (RFC-24 R4). Never
 * rejects a request that carries neither a Bearer header nor a cookie.
 * @rfc RFC-22 R7
 * @rfc RFC-82 R3, R4
 * @rfc RFC-24 R4
 */
export function resolveSession(deps: {
  sessions: SessionStore;
  db: Db;
  limiter: RateLimiter;
  now?: () => number;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    // Detected on the scheme alone, not on `bearerToken` parsing, so a
    // malformed token (empty, or more than one word) is still treated as a
    // key attempt rather than falling through to anonymous/cookie handling.
    const looksLikeBearer = authHeader !== undefined && /^bearer\b/i.test(authHeader);
    const raw = bearerToken(authHeader);
    const rawId = getCookie(c, SESSION_COOKIE);

    if (looksLikeBearer) {
      if (raw !== null && !rawId) {
        const found = await findUsableKey({ db: deps.db, now: deps.now ?? Date.now }, raw);
        if (found) {
          c.set('user', found.user);
          c.set('apiKey', { id: found.id });
          return auditVia.run({ apiKeyId: found.id }, () => next());
        }
      }
      const decision = await deps.limiter.hit('global:ip', ipKey(c), RATE_LIMITS.globalIp);
      if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
      throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
    }

    if (rawId) {
      const session = await deps.sessions.get(rawId);
      const user = session ? await findUserById(deps.db, session.userId) : null;
      if (session && user && user.status === 'active') {
        c.set('session', session);
        c.set('user', user);
      } else {
        if (session) await deps.sessions.revoke(session.id);
        clearSessionCookie(c);
      }
    }
    await next();
  };
}

/**
 * @rfc RFC-22 R8
 * @rfc RFC-82 R6
 */
export const requireSession: MiddlewareHandler<AppEnv> = markGuard(async (c, next) => {
  if (!c.get('session')) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
  await next();
}, 'session');

/**
 * @rfc RFC-32 R5
 * @rfc RFC-82 R10
 */
export const requireApiKey: MiddlewareHandler<AppEnv> = markGuard(async (c, next) => {
  if (!c.get('apiKey')) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
  await next();
}, 'apiKey');

/** For handlers behind `requireSession`. @rfc RFC-22 R8 */
export function currentUser(c: Context<AppEnv>): UserRow {
  const user = c.get('user');
  if (!user) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
  return user;
}

/** @rfc RFC-22 R8 */
export function currentSession(c: Context<AppEnv>): SessionRecord {
  const session = c.get('session');
  if (!session) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
  return session;
}
