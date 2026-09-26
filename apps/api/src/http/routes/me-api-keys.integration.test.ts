import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { adminRoleId } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser, DEFAULT_PASSWORD } from '../../../test/helpers/users.ts';
import { generateTotpCode, generateTotpSecret } from '../../auth/totp.ts';

describe('RFC-82 R2, R6, R7 /api/me/api-keys', () => {
  const t = useTestApp();

  it('creates, lists, uses and revokes a key; the key cannot manage keys', async () => {
    const secret = generateTotpSecret();
    const { user } = await createUser(t.db, {
      totpSecret: secret,
      roles: [await adminRoleId(t.db)],
    });
    const { cookie } = await loginAs(t, user);

    const created = await call(t.app, 'POST', '/api/me/api-keys', {
      cookie,
      body: {
        name: 'laptop',
        password: DEFAULT_PASSWORD,
        code: generateTotpCode(secret, t.clock.now),
      },
    });
    expect(created.status).toBe(200);
    const { data } = await created.json();
    expect(data.secret).toMatch(/^tr_live_/);

    const list = await (await call(t.app, 'GET', '/api/me/api-keys', { cookie })).json();
    expect(list.data).toMatchObject({
      eligible: true,
      keys: [{ id: data.key.id, state: 'active' }],
    });

    const viaKey = await call(t.app, 'GET', '/api/me/api-keys', {
      headers: { authorization: `Bearer ${data.secret}` },
      origin: null,
    });
    expect(viaKey.status).toBe(401);

    const del = await call(t.app, 'DELETE', `/api/me/api-keys/${data.key.id}`, { cookie });
    expect(del.status).toBe(200);
    const after = await call(t.app, 'GET', '/api/admin/roles', {
      headers: { authorization: `Bearer ${data.secret}` },
      origin: null,
    });
    expect(after.status).toBe(401);
  });

  it('R7 a contributor sees eligible false; R2 creation is rate-limited per user', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const list = await (await call(t.app, 'GET', '/api/me/api-keys', { cookie })).json();
    expect(list.data).toEqual({ eligible: false, keys: [] });
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = (
        await call(t.app, 'POST', '/api/me/api-keys', {
          cookie,
          body: { name: 'x', password: 'x', code: '000000' },
        })
      ).status;
    }
    expect(last).toBe(429);
  });

  it('rejects a non-UUID :id with 400 VALIDATION_FAILED', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'DELETE', '/api/me/api-keys/not-a-uuid', { cookie });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
  });
});
