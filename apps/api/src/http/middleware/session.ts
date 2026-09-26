import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { auditVia } from '../../audit/via.ts';
import { bearerToken, findUsableKey } from '../../auth/api-keys.ts';
import type { SessionRecord, SessionStore } from '../../auth/sessions.ts';
import { findUserById } from '../../auth/users.ts';
import type { Db } from '../../db/client.ts';
import type { UserRow } from '../../db/schema/users.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import { markGuard } from '../guards.ts';

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
 * context; an invalid one is revoked and cleared. A Bearer header
 * authenticates independently of the cookie and never sets `session`, so a
 * key never reaches a self-service route (RFC-82 R6). Never rejects a
 * request that carries neither.
 * @rfc RFC-22 R7
 * @rfc RFC-82 R3, R4
 */
export function resolveSession(deps: {
  sessions: SessionStore;
  db: Db;
  now?: () => number;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = bearerToken(c.req.header('authorization'));
    const rawId = getCookie(c, SESSION_COOKIE);
    if (raw !== null) {
      // RFC-82 R3, R4: a Bearer header authenticates or the request stops here.
      if (rawId)
        throw new AppError('AUTH_UNAUTHENTICATED', 'Use a session or an API key, not both');
      const found = await findUsableKey({ db: deps.db, now: deps.now ?? Date.now }, raw);
      if (!found) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
      c.set('user', found.user);
      c.set('apiKey', { id: found.id });
      return auditVia.run({ apiKeyId: found.id }, () => next());
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
