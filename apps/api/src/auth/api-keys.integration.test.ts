import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ctxOf, useTestApp } from '../../test/helpers/app.ts';
import { lastAudit } from '../../test/helpers/audit.ts';
import { adminRoleId, systemRoleId } from '../../test/helpers/roles.ts';
import { createUser, DEFAULT_PASSWORD } from '../../test/helpers/users.ts';
import { apiKeys } from '../db/schema/api-keys.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { users } from '../db/schema/users.ts';
import {
  bearerToken,
  createApiKey,
  findUsableKey,
  generateApiKey,
  listApiKeys,
  revokeApiKey,
} from './api-keys.ts';
import { generateTotpCode, generateTotpSecret } from './totp.ts';

const META = { ip: '10.0.0.1', userAgent: 'test-agent' };

describe('RFC-82 R1-R3, R7, R8 API key service', () => {
  const t = useTestApp();

  async function admin() {
    const secret = generateTotpSecret();
    const { user } = await createUser(t.db, {
      totpSecret: secret,
      roles: [await adminRoleId(t.db)],
    });
    return { user, secret };
  }
  const code = (secret: string, offset = 0) =>
    generateTotpCode(secret, t.clock.now + offset * 30_000);

  it('R1 generates tr_live_ keys of 43 base64url characters and reads a Bearer header', () => {
    expect(generateApiKey()).toMatch(/^tr_live_[A-Za-z0-9_-]{43}$/);
    expect(bearerToken('Bearer tr_live_abc')).toBe('tr_live_abc');
    expect(bearerToken('bearer tr_live_x')).toBe('tr_live_x');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Basic x')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it('R2 creates a key for an admin with password and TOTP, stores only the hash, audits it', async () => {
    const { user, secret } = await admin();
    const out = await createApiKey(ctxOf(t), {
      user,
      name: 'laptop',
      password: DEFAULT_PASSWORD,
      code: code(secret),
      ...META,
    });
    expect(out.secret).toMatch(/^tr_live_/);
    expect(out.key).toMatchObject({
      name: 'laptop',
      state: 'active',
      prefix: out.secret.slice(8, 16),
    });
    const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, out.key.id));
    if (!row) throw new Error('api key row: no row');
    expect(row.keyHash).not.toContain(out.secret);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(await lastAudit(t.db, 'auth.api_key.created', { actorUserId: user.id })).toMatchObject({
      targetType: 'api_key',
      targetId: out.key.id,
    });
  });

  it('R2 refuses a non-admin, a user without TOTP, a wrong password and a reused code', async () => {
    const contributorSecret = generateTotpSecret();
    const contributor = await createUser(t.db, {
      totpSecret: contributorSecret,
      roles: [await systemRoleId(t.db, 'contributor')],
    });
    await expect(
      createApiKey(ctxOf(t), {
        user: contributor.user,
        name: 'x',
        password: DEFAULT_PASSWORD,
        code: code(contributorSecret),
        ...META,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const noTotp = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    await expect(
      createApiKey(ctxOf(t), {
        user: noTotp.user,
        name: 'x',
        password: DEFAULT_PASSWORD,
        code: '000000',
        ...META,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_NOT_ENABLED' });

    const { user, secret } = await admin();
    await expect(
      createApiKey(ctxOf(t), { user, name: 'x', password: 'wrong', code: code(secret), ...META }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    await createApiKey(ctxOf(t), {
      user,
      name: 'x',
      password: DEFAULT_PASSWORD,
      code: code(secret, 1),
      ...META,
    });
    await expect(
      createApiKey(ctxOf(t), {
        user,
        name: 'y',
        password: DEFAULT_PASSWORD,
        code: code(secret, 1),
        ...META,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_INVALID' });
  });

  it('R3 resolves a usable key and refuses revoked, expired, suspended and demoted owners', async () => {
    const { user, secret } = await admin();
    const deps = { db: t.db, now: () => t.clock.now };
    const make = async (offset: number) => {
      const out = await createApiKey(ctxOf(t), {
        user,
        name: 'k',
        password: DEFAULT_PASSWORD,
        code: code(secret, offset),
        ...META,
      });
      return { id: out.key.id, secret: out.secret };
    };
    const lastUsedAtOf = async (id: string) => {
      const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, id));
      return row?.lastUsedAt ?? null;
    };

    const ok = await make(0);
    expect((await findUsableKey(deps, ok.secret))?.user.id).toBe(user.id);
    expect(await findUsableKey(deps, 'tr_live_unknown')).toBeNull();

    // R3: last_used_at is written at most once a minute per key.
    const firstTouch = await lastUsedAtOf(ok.id);
    expect(firstTouch?.getTime()).toBe(t.clock.now);
    t.clock.now += 59_999; // still within the one-minute window
    await findUsableKey(deps, ok.secret);
    expect((await lastUsedAtOf(ok.id))?.getTime()).toBe(firstTouch?.getTime());
    t.clock.now += 2; // now 60_001ms after the first touch: past the window
    await findUsableKey(deps, ok.secret);
    expect((await lastUsedAtOf(ok.id))?.getTime()).toBe(t.clock.now);

    const expired = await make(0);
    await t.db
      .update(apiKeys)
      .set({ expiresAt: new Date(t.clock.now - 1) })
      .where(eq(apiKeys.id, expired.id));
    expect(await findUsableKey(deps, expired.secret)).toBeNull();

    const revoked = await make(1);
    await revokeApiKey(ctxOf(t), { user, id: revoked.id, ...META });
    expect(await findUsableKey(deps, revoked.secret)).toBeNull();

    await t.db.delete(userRoles).where(eq(userRoles.userId, user.id));
    expect(await findUsableKey(deps, ok.secret)).toBeNull();
    await t.db.insert(userRoles).values({ userId: user.id, roleId: await adminRoleId(t.db) });
    expect(await findUsableKey(deps, ok.secret)).not.toBeNull();

    await t.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));
    expect(await findUsableKey(deps, ok.secret)).toBeNull();
  });

  it('R7, R8 lists own keys newest first and revokes only own active keys', async () => {
    const a = await admin();
    const b = await admin();
    const first = await createApiKey(ctxOf(t), {
      user: a.user,
      name: 'one',
      password: DEFAULT_PASSWORD,
      code: code(a.secret, 0),
      ...META,
    });
    const second = await createApiKey(ctxOf(t), {
      user: a.user,
      name: 'two',
      password: DEFAULT_PASSWORD,
      code: code(a.secret, 1),
      ...META,
    });

    await expect(
      revokeApiKey(ctxOf(t), { user: b.user, id: first.key.id, ...META }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await revokeApiKey(ctxOf(t), { user: a.user, id: first.key.id, ...META });
    await expect(
      revokeApiKey(ctxOf(t), { user: a.user, id: first.key.id, ...META }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await lastAudit(t.db, 'auth.api_key.revoked', { actorUserId: a.user.id })).toMatchObject(
      {
        targetId: first.key.id,
      },
    );

    // Ruling (R7): "any other id answers 404" also covers a key of the caller's
    // own that has already expired — revoking it is not distinguishable from
    // revoking someone else's or an unknown one.
    const expired = await createApiKey(ctxOf(t), {
      user: b.user,
      name: 'expired',
      password: DEFAULT_PASSWORD,
      code: code(b.secret, 0),
      ...META,
    });
    await t.db
      .update(apiKeys)
      .set({ expiresAt: new Date(t.clock.now - 1) })
      .where(eq(apiKeys.id, expired.key.id));
    await expect(
      revokeApiKey(ctxOf(t), { user: b.user, id: expired.key.id, ...META }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const list = await listApiKeys(ctxOf(t), a.user);
    expect(list.eligible).toBe(true);
    expect(list.keys.map((k) => [k.name, k.state])).toEqual([
      ['two', 'active'],
      ['one', 'revoked'],
    ]);
    expect(second.key.id).toBe(list.keys[0]?.id);
  });
});
