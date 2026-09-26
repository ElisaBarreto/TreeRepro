import { describe, expect, it } from 'vitest';
import { call, randomIp, useTestApp } from '../../test/helpers/app.ts';
import { lastAudit } from '../../test/helpers/audit.ts';
import { adminRoleId } from '../../test/helpers/roles.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser } from '../../test/helpers/users.ts';
import { generateApiKey } from '../auth/api-keys.ts';
import { RATE_LIMITS } from '../auth/rate-limit.ts';
import { hashToken } from '../auth/tokens.ts';
import { apiKeys } from '../db/schema/api-keys.ts';

describe('RFC-82 R3-R6, R8, R9 Bearer authentication', () => {
  const t = useTestApp();

  async function adminWithKey() {
    const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const raw = generateApiKey();
    const [key] = await t.db
      .insert(apiKeys)
      .values({
        userId: user.id,
        name: 'k',
        keyHash: hashToken(raw),
        keyPrefix: raw.slice(8, 16),
        expiresAt: new Date(t.clock.now + 86_400_000),
      })
      .returning();
    if (!key) throw new Error('adminWithKey: insert returned no row');
    return { user, raw, key };
  }
  const bearer = (raw: string) => ({ authorization: `Bearer ${raw}` });

  it('R3 a valid key reaches a permission-guarded route as its owner', async () => {
    const { raw } = await adminWithKey();
    const res = await call(t.app, 'GET', '/api/admin/roles', {
      headers: bearer(raw),
      origin: null,
    });
    expect(res.status).toBe(200);
  });

  it('R3 an unknown key answers 401 even on a public route', async () => {
    const res = await call(t.app, 'POST', '/api/auth/login', {
      headers: bearer('tr_live_nope'),
      origin: null,
      body: { email: 'a@b.test', password: 'x' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('R3 a lowercase "bearer" scheme with an unknown key still answers 401 on a public route', async () => {
    const res = await call(t.app, 'POST', '/api/auth/login', {
      headers: { authorization: 'bearer tr_live_nope' },
      origin: null,
      body: { email: 'a@b.test', password: 'x' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('R3 a Bearer scheme with no token answers 401, not an anonymous pass-through', async () => {
    // No Origin is sent, so a false exemption here would surface as 403
    // (SECURITY_INVALID_ORIGIN) instead of the 401 this asserts; the default
    // Origin is kept so the only thing under test is resolveSession's own
    // handling of a header it cannot parse as a key.
    const res = await call(t.app, 'POST', '/api/auth/login', {
      headers: { authorization: 'Bearer ' },
      body: { email: 'a@b.test', password: 'x' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('R3 a Bearer scheme with more than one token answers 401, not an anonymous pass-through', async () => {
    const res = await call(t.app, 'POST', '/api/auth/login', {
      headers: { authorization: 'Bearer a b' },
      body: { email: 'a@b.test', password: 'x' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('RFC-24 R4 a flood of bogus keys from one IP still counts against global:ip', async () => {
    const ip = randomIp();
    for (let i = 0; i < RATE_LIMITS.globalIp.limit; i++) {
      const res = await call(t.app, 'POST', '/api/auth/login', {
        headers: bearer('tr_live_nope'),
        origin: null,
        ip,
        body: { email: 'a@b.test', password: 'x' },
      });
      expect(res.status).toBe(401);
    }
    const last = await call(t.app, 'POST', '/api/auth/login', {
      headers: bearer('tr_live_nope'),
      origin: null,
      ip,
      body: { email: 'a@b.test', password: 'x' },
    });
    expect(last.status).toBe(429);
  });

  it('R4 a cookie and a key together answer 401', async () => {
    const { user, raw } = await adminWithKey();
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'GET', '/api/admin/roles', { cookie, headers: bearer(raw) });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('R5 a Bearer-only write needs no Origin; a cookie write still does', async () => {
    const { user, raw } = await adminWithKey();
    const res = await call(t.app, 'POST', '/api/admin/roles', {
      headers: bearer(raw),
      origin: null,
      body: { name: `r-${Date.now()}`, permissions: [] },
    });
    expect(res.status).toBe(201);
    const { cookie } = await loginAs(t, user);
    const cookieRes = await call(t.app, 'POST', '/api/admin/roles', {
      cookie,
      origin: null,
      body: { name: 'x', permissions: [] },
    });
    expect((await cookieRes.json()).error.code).toBe('SECURITY_INVALID_ORIGIN');
  });

  it('R6 self-service routes refuse a key', async () => {
    const { raw } = await adminWithKey();
    for (const [method, path] of [
      ['GET', '/api/auth/me'],
      ['GET', '/api/me/sessions'],
      ['GET', '/api/help'],
    ] as const) {
      const res = await call(t.app, method, path, { headers: bearer(raw), origin: null });
      expect(res.status, path).toBe(401);
    }
  });

  it('R8 audit entries written with a key carry via and apiKeyId', async () => {
    const { user, raw, key } = await adminWithKey();
    const name = `r-${Date.now()}`;
    await call(t.app, 'POST', '/api/admin/roles', {
      headers: bearer(raw),
      origin: null,
      body: { name, permissions: [] },
    });
    expect(await lastAudit(t.db, 'roles.created', { actorUserId: user.id })).toMatchObject({
      metadata: { via: 'api_key', apiKeyId: key.id },
    });
  });

  it('R9 a key-authenticated request is counted in global:api_key, not global:ip', async () => {
    const { raw, key } = await adminWithKey();
    await call(t.app, 'GET', '/api/admin/roles', { headers: bearer(raw), origin: null });
    expect(await t.redis.exists(`rl:global:api_key:${key.id}`)).toBe(1);
  });
});
