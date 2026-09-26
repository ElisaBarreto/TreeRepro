import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ctxOf, useTestApp } from '../../test/helpers/app.ts';
import { lastAudit } from '../../test/helpers/audit.ts';
import { adminRoleId, systemRoleId } from '../../test/helpers/roles.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser, DEFAULT_PASSWORD } from '../../test/helpers/users.ts';
import { revokeAllUserSessions } from '../admin/sessions.ts';
import { reactivateUser, suspendUser, updateUser } from '../admin/users.ts';
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
import { changePassword, resetPassword } from './flows/password.ts';
import { logoutAll } from './flows/session.ts';
import { disableTotp } from './flows/totp.ts';
import { hashToken, issueToken } from './tokens.ts';
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

  it('R2, R3 refuses when the password, status, TOTP or admin role changed after the request loaded the user', async () => {
    const { user, secret } = await admin();
    await t.db.update(users).set({ passwordHash: 'changed' }).where(eq(users.id, user.id));
    await expect(
      createApiKey(ctxOf(t), {
        user,
        name: 'stale',
        password: DEFAULT_PASSWORD,
        code: code(secret),
        ...META,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

    const other = await admin();
    await t.db.update(users).set({ status: 'suspended' }).where(eq(users.id, other.user.id));
    await expect(
      createApiKey(ctxOf(t), {
        user: other.user,
        name: 'stale',
        password: DEFAULT_PASSWORD,
        code: code(other.secret),
        ...META,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });

    // TOTP disabled after the request loaded the user.
    const noTotp = await admin();
    await t.db
      .update(users)
      .set({ totpSecret: null, totpEnabledAt: null })
      .where(eq(users.id, noTotp.user.id));
    await expect(
      createApiKey(ctxOf(t), {
        user: noTotp.user,
        name: 'stale',
        password: DEFAULT_PASSWORD,
        code: code(noTotp.secret),
        ...META,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_NOT_ENABLED' });

    // Admin role removed while the password and code were being verified.
    const demoted = await admin();
    const ctx = ctxOf(t);
    const racing = {
      ...ctx,
      mfa: {
        ...ctx.mfa,
        claimTotpCounter: async (userId: string, counter: number) => {
          await t.db.delete(userRoles).where(eq(userRoles.userId, demoted.user.id));
          return ctx.mfa.claimTotpCounter(userId, counter);
        },
      },
    };
    await expect(
      createApiKey(racing, {
        user: demoted.user,
        name: 'stale',
        password: DEFAULT_PASSWORD,
        code: code(demoted.secret),
        ...META,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    for (const u of [user, other.user, noTotp.user, demoted.user]) {
      expect(await t.db.select().from(apiKeys).where(eq(apiKeys.userId, u.id))).toEqual([]);
    }
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

    // The role is read on every request: a row removed behind the service's
    // back already refuses the key.
    await t.db.delete(userRoles).where(eq(userRoles.userId, user.id));
    expect(await findUsableKey(deps, ok.secret)).toBeNull();
    await t.db.insert(userRoles).values({ userId: user.id, roleId: await adminRoleId(t.db) });

    await t.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));
    expect(await findUsableKey(deps, ok.secret)).toBeNull();
    await t.db.update(users).set({ status: 'active' }).where(eq(users.id, user.id));
    expect(await findUsableKey(deps, ok.secret)).not.toBeNull();

    // A demotion through the service revokes the key, so a new grant revives nothing.
    const { user: actor } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    await updateUser(ctxOf(t), { actorUserId: actor.id, id: user.id, roleIds: [], ...META });
    await t.db.insert(userRoles).values({ userId: user.id, roleId: await adminRoleId(t.db) });
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

describe('RFC-82 R3 account-recovery actions revoke every active key', () => {
  const t = useTestApp();
  const NEW_PASSWORD = 'another perfectly fine passphrase';

  async function adminWithKeys() {
    const secret = generateTotpSecret();
    const { user } = await createUser(t.db, {
      totpSecret: secret,
      roles: [await adminRoleId(t.db)],
    });
    const keys = [];
    for (const name of ['a', 'b']) {
      const raw = generateApiKey();
      const [row] = await t.db
        .insert(apiKeys)
        .values({
          userId: user.id,
          name,
          keyHash: hashToken(raw),
          keyPrefix: raw.slice(8, 16),
          expiresAt: new Date(t.clock.now + 86_400_000),
        })
        .returning();
      if (!row) throw new Error('adminWithKeys: insert returned no row');
      keys.push({ id: row.id, raw });
    }
    return { user, secret, keys };
  }

  async function expectRevoked(
    keys: { id: string; raw: string }[],
    actorUserId: string,
    reason: string,
  ) {
    const deps = { db: t.db, now: () => t.clock.now };
    for (const key of keys) {
      const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
      expect(row?.revokedAt?.getTime()).toBe(t.clock.now);
      expect(await findUsableKey(deps, key.raw)).toBeNull();
      expect(await lastAudit(t.db, 'auth.api_key.revoked', { targetId: key.id })).toMatchObject({
        actorUserId,
        targetType: 'api_key',
        metadata: { reason },
      });
    }
  }

  it('password reset', async () => {
    const { user, keys } = await adminWithKeys();
    const { raw } = await t.db.transaction((tx) =>
      issueToken(tx, { userId: user.id, kind: 'password_reset', now: new Date(t.clock.now) }),
    );
    await resetPassword(ctxOf(t), { token: raw, newPassword: NEW_PASSWORD, ...META });
    await expectRevoked(keys, user.id, 'password_reset');
  });

  it('password change', async () => {
    const { user, keys } = await adminWithKeys();
    const { rawId } = await loginAs(t, user);
    const session = await t.sessions.get(rawId);
    if (!session) throw new Error('password change: no session');
    await changePassword(ctxOf(t), {
      user,
      session,
      currentPassword: DEFAULT_PASSWORD,
      newPassword: NEW_PASSWORD,
      ...META,
    });
    await expectRevoked(keys, user.id, 'password_change');
  });

  it('TOTP disable', async () => {
    const { user, secret, keys } = await adminWithKeys();
    await disableTotp(ctxOf(t), {
      user,
      password: DEFAULT_PASSWORD,
      code: generateTotpCode(secret, t.clock.now),
      ...META,
    });
    await expectRevoked(keys, user.id, 'totp_disabled');
  });

  it('sign out everywhere', async () => {
    const { user, keys } = await adminWithKeys();
    await logoutAll(ctxOf(t), { user, ...META });
    await expectRevoked(keys, user.id, 'logout_all');
  });

  it('sign out everywhere waits for a key creation in flight and revokes that key too', async () => {
    const { user } = await adminWithKeys();
    const raw = generateApiKey();
    let signOut: Promise<number> | undefined;
    const inFlight = await t.db.transaction(async (tx) => {
      // What createApiKey does: lock the user row, then insert.
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, user.id))
        .for('no key update');
      const [row] = await tx
        .insert(apiKeys)
        .values({
          userId: user.id,
          name: 'in-flight',
          keyHash: hashToken(raw),
          keyPrefix: raw.slice(8, 16),
          expiresAt: new Date(t.clock.now + 86_400_000),
        })
        .returning();
      signOut = logoutAll(ctxOf(t), { user, ...META });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return row;
    });
    await signOut;
    await expectRevoked([{ id: inFlight?.id ?? '', raw }], user.id, 'logout_all');
  });

  it('admin role removed', async () => {
    const { user, keys } = await adminWithKeys();
    const { user: actor } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const manager = await systemRoleId(t.db, 'manager');
    await updateUser(ctxOf(t), { actorUserId: actor.id, id: user.id, roleIds: [manager], ...META });
    await expectRevoked(keys, actor.id, 'admin_role_removed');
  });

  it('a role change that keeps the admin role revokes nothing', async () => {
    const { user, keys } = await adminWithKeys();
    const { user: actor } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const roleIds = [await adminRoleId(t.db), await systemRoleId(t.db, 'manager')];
    await updateUser(ctxOf(t), { actorUserId: actor.id, id: user.id, roleIds, ...META });
    for (const key of keys) {
      const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
      expect(row?.revokedAt).toBeNull();
    }
  });

  it("an administrator revoking all of the user's sessions", async () => {
    const { user, keys } = await adminWithKeys();
    const { user: actor } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    await revokeAllUserSessions(ctxOf(t), { actorUserId: actor.id, userId: user.id, ...META });
    await expectRevoked(keys, actor.id, 'sessions_revoked');
  });

  it('suspension, and reactivation brings no key back', async () => {
    const { user, keys } = await adminWithKeys();
    const { user: actor } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    await suspendUser(ctxOf(t), { actorUserId: actor.id, id: user.id, ...META });
    await expectRevoked(keys, actor.id, 'user_suspended');
    await reactivateUser(ctxOf(t), { actorUserId: actor.id, id: user.id, ...META });
    for (const key of keys) {
      expect(await findUsableKey({ db: t.db, now: () => t.clock.now }, key.raw)).toBeNull();
    }
  });
});
