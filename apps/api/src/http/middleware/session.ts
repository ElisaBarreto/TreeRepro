import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
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
 * context; an invalid one is revoked and cleared. Never rejects by itself.
 * @rfc RFC-22 R7
 */
export function resolveSession(deps: {
  sessions: SessionStore;
  db: Db;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const rawId = getCookie(c, SESSION_COOKIE);
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

/** @rfc RFC-22 R8 */
export const requireSession: MiddlewareHandler<AppEnv> = markGuard(async (c, next) => {
  if (!c.get('user')) throw new AppError('AUTH_UNAUTHENTICATED', 'Authentication required');
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
