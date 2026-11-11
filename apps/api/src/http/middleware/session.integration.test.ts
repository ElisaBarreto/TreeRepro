import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  call,
  cookieFrom,
  setCookieLine,
  TEST_DOMAINS,
  useTestApp,
} from '../../../test/helpers/app.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { users } from '../../db/schema/users.ts';
import type { AppEnv } from '../env.ts';
import { createErrorHandler } from '../errors.ts';
import { isGuard } from '../guards.ts';
import { resolvePlatform } from '../platform.ts';
import { currentUser, requireSession, resolveSession, setSessionCookie } from './session.ts';

describe('RFC-22 R5, R7, R8 session middleware', () => {
  const t = useTestApp();

  function app() {
    const a = new Hono<AppEnv>();
    a.use(resolvePlatform(TEST_DOMAINS));
    a.use(resolveSession({ sessions: t.sessions, db: t.db, limiter: t.limiter }));
    a.get('/who', (c) =>
      c.json({ user: c.get('user')?.id ?? null, session: c.get('session')?.id ?? null }),
    );
    a.get('/private', requireSession, (c) => c.json({ id: currentUser(c).id }));
    a.get('/login-cookie', (c) => {
      setSessionCookie(c, 'raw-id');
      return c.json({});
    });
    a.onError(createErrorHandler(t.deps.logger));
    return a;
  }

  it('R5 sets __Host-session with HttpOnly, Secure, SameSite=Strict and Path=/', async () => {
    const res = await app().request('/login-cookie');
    const line = setCookieLine(res, '__Host-session');
    expect(line).toMatch(/^__Host-session=raw-id;/);
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Strict');
    expect(line).toContain('Path=/');
  });

  it('R7 resolves user and session from a valid cookie and ignores an unknown one', async () => {
    const { user } = await createUser(t.db);
    const { cookie, id } = await loginAs(t, user);
    const res = await call(app(), 'GET', '/who', { cookie });
    expect(await res.json()).toEqual({ user: user.id, session: id });
    const bad = await call(app(), 'GET', '/who', { cookie: `__Host-session=${'A'.repeat(43)}` });
    expect(await bad.json()).toEqual({ user: null, session: null });
    expect(setCookieLine(bad, '__Host-session')).toContain('Max-Age=0');
  });

  it('RFC-14 R5 a session authenticates only on its platform, and is kept', async () => {
    const { user } = await createUser(t.db);
    const { cookie, id, rawId } = await loginAs(t, user, { platform: 'plantrepro' });
    const plant = await call(app(), 'GET', 'http://plantrepro.localhost/who', { cookie });
    expect(await plant.json()).toEqual({ user: user.id, session: id });
    const tree = await call(app(), 'GET', '/who', { cookie });
    expect(await tree.json()).toEqual({ user: null, session: null });
    expect(setCookieLine(tree, '__Host-session')).toContain('Max-Age=0');
    expect((await call(app(), 'GET', '/private', { cookie })).status).toBe(401);
    expect(await t.sessions.get(rawId)).not.toBeNull();
  });

  it('RFC-14 R5 a session recorded before platforms existed authenticates on TreeRepro', async () => {
    const { user } = await createUser(t.db);
    const { cookie, id } = await loginAs(t, user);
    await t.redis.hdel(`session:${id}`, 'platform');
    const res = await call(app(), 'GET', '/who', { cookie });
    expect(await res.json()).toEqual({ user: user.id, session: id });
    const plant = await call(app(), 'GET', 'http://plantrepro.localhost/who', { cookie });
    expect(await plant.json()).toEqual({ user: null, session: null });
  });

  it('R7 logs out a user that is no longer active and clears the cookie', async () => {
    const { user } = await createUser(t.db);
    const { cookie, rawId } = await loginAs(t, user);
    await t.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));
    const res = await call(app(), 'GET', '/who', { cookie });
    expect(await res.json()).toEqual({ user: null, session: null });
    expect(setCookieLine(res, '__Host-session')).toContain('Max-Age=0');
    expect(await t.sessions.get(rawId)).toBeNull();
  });

  it('R8 requireSession answers 401 AUTH_UNAUTHENTICATED and is a registered guard', async () => {
    const res = await call(app(), 'GET', '/private');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    expect(await (await call(app(), 'GET', '/private', { cookie })).json()).toEqual({
      id: user.id,
    });
    expect(isGuard(requireSession)).toBe(true);
    expect(cookieFrom(res, '__Host-session')).toBeNull();
  });
});
