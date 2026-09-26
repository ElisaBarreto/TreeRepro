import { ADMIN_ONLY_PERMISSIONS, PERMISSION_KEYS } from '@treerepro/contracts';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { lastAudit } from '../../test/helpers/audit.ts';
import { withRollback } from '../../test/helpers/db.ts';
import { adminRoleId, createRole as insertRole, systemRoleId } from '../../test/helpers/roles.ts';
import { createUser } from '../../test/helpers/users.ts';
import { createDb, type DbExecutor } from '../db/client.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { users } from '../db/schema/users.ts';
import { AppError } from '../http/errors.ts';
import { resolvePermissions } from './permissions.ts';
import {
  assertNotLastAdmin,
  createRole,
  deleteRole,
  getRole,
  listRoles,
  setUserRoles,
  updateRole,
  userIdsWithRole,
} from './roles.ts';

const uniq = () => `Role ${Math.random().toString(16).slice(2)}`;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
}

describe('RFC-31 R3, R4, R5 role services', () => {
  const t = useTestApp();
  const ctx = () => ({
    db: t.db,
    permissionCache: t.permissionCache,
    logger: t.deps.logger,
    now: () => t.clock.now,
  });

  it('creates a role with trimmed name and permissions, audits, and serializes it', async () => {
    // The actor holds what the new role receives (R12).
    const { user: actor } = await createUser(t.db, {
      roles: [(await insertRole(t.db, { permissions: ['users.read', 'audit.read'] })).id],
    });
    const name = uniq();
    const role = await createRole(ctx(), {
      name: `  ${name} `,
      permissions: ['users.read', 'users.read', 'audit.read'],
      actorUserId: actor.id,
    });
    expect(role).toMatchObject({
      name,
      description: '',
      isSystem: false,
      permissions: ['audit.read', 'users.read'],
    });
    expect(await getRole(t.db, role.id)).toEqual(role);
    expect(await lastAudit(t.db, 'roles.created', { targetId: role.id })).toMatchObject({
      actorUserId: actor.id,
      targetType: 'role',
      targetId: role.id,
      metadata: { permissions: ['audit.read', 'users.read'] },
    });
  });

  it('refuses a duplicate name case-insensitively and unknown permissions with details', async () => {
    const name = uniq();
    await createRole(ctx(), { name, permissions: [], actorUserId: null });
    expect(
      await code(
        createRole(ctx(), { name: name.toUpperCase(), permissions: [], actorUserId: null }),
      ),
    ).toBe('ROLE_NAME_TAKEN');
    const err = await createRole(ctx(), {
      name: uniq(),
      permissions: ['users.read', 'users.fly', 'nope'],
      actorUserId: null,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('PERMISSION_UNKNOWN');
    expect((err as AppError).details).toEqual([
      { path: 'permissions', message: 'users.fly' },
      { path: 'permissions', message: 'nope' },
    ]);
  });

  it('RFC-31 R15 no custom role may hold dataset.export or records.withdraw_imported', async () => {
    const role = await createRole(ctx(), {
      name: uniq(),
      permissions: ['users.read'],
      actorUserId: null,
    });
    for (const key of ['dataset.export', 'records.withdraw_imported']) {
      for (const attempt of [
        createRole(ctx(), { name: uniq(), permissions: ['users.read', key], actorUserId: null }),
        updateRole(ctx(), { id: role.id, permissions: ['users.read', key], actorUserId: null }),
      ]) {
        const err = await attempt.catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('VALIDATION_FAILED');
        expect((err as AppError).details).toEqual([{ path: 'permissions', message: key }]);
      }
    }
    expect((await getRole(t.db, role.id))?.permissions).toEqual(['users.read']);
  });

  it('updates fields and permissions, audits the changed fields and invalidates every holder', async () => {
    const role = await createRole(ctx(), {
      name: uniq(),
      permissions: ['users.read'],
      actorUserId: null,
    });
    const a = await createUser(t.db, { roles: [role.id] });
    const b = await createUser(t.db, { roles: [role.id] });
    expect([...(await resolvePermissions(ctx(), a.user.id))]).toEqual(['users.read']);
    expect([...(await resolvePermissions(ctx(), b.user.id))]).toEqual(['users.read']);
    const updated = await updateRole(ctx(), {
      id: role.id,
      description: 'Edits',
      permissions: ['audit.read'],
      actorUserId: null,
    });
    expect(updated.description).toBe('Edits');
    expect(updated.permissions).toEqual(['audit.read']);
    expect(updated.updatedAt >= role.updatedAt).toBe(true);
    expect(await lastAudit(t.db, 'roles.updated', { targetId: role.id })).toMatchObject({
      targetId: role.id,
      metadata: { changes: ['description', 'permissions'] },
    });
    expect([...(await resolvePermissions(ctx(), a.user.id))]).toEqual(['audit.read']);
    expect([...(await resolvePermissions(ctx(), b.user.id))]).toEqual(['audit.read']);
    expect((await userIdsWithRole(t.db, role.id)).sort()).toEqual([a.user.id, b.user.id].sort());
    await updateRole(ctx(), {
      id: role.id,
      name: `${role.name} renamed`,
      permissions: ['audit.read', 'audit.read'],
      actorUserId: null,
    });
    expect(await lastAudit(t.db, 'roles.updated', { targetId: role.id })).toMatchObject({
      targetId: role.id,
      metadata: { changes: ['name'] },
    });
    expect(
      await code(
        updateRole(ctx(), {
          id: '019b4a2e-5f3c-7c8e-8d1a-2f3b4c5d6e7f',
          name: 'x',
          actorUserId: null,
        }),
      ),
    ).toBe('ROLE_NOT_FOUND');
  });

  it('R2 the admin system role cannot be edited or deleted', async () => {
    const id = await adminRoleId(t.db);
    expect(await code(updateRole(ctx(), { id, description: 'x', actorUserId: null }))).toBe(
      'ROLE_IS_SYSTEM',
    );
    expect(await code(deleteRole(ctx(), { id, actorUserId: null }))).toBe('ROLE_IS_SYSTEM');
    const admin = await getRole(t.db, id);
    expect(admin?.isSystem).toBe(true);
    expect(admin?.permissions).toEqual([...PERMISSION_KEYS].sort());
  });

  it('RFC-31 R2, R11 manager and contributor cannot be edited or deleted and list their permissions', async () => {
    const id = await systemRoleId(t.db, 'contributor');
    await expect(
      updateRole(ctx(), { id, description: 'x', actorUserId: null }),
    ).rejects.toMatchObject({ code: 'ROLE_IS_SYSTEM' });
    await expect(deleteRole(ctx(), { id, actorUserId: null })).rejects.toMatchObject({
      code: 'ROLE_IS_SYSTEM',
    });
    const listed = (await listRoles(t.db)).find((r) => r.id === id);
    expect(listed?.isSystem).toBe(true);
    expect(listed?.permissions.sort()).toEqual([
      'dataset.read',
      'records.annotate',
      'records.create',
      'taxa.propose',
    ]);

    const managerId = await systemRoleId(t.db, 'manager');
    const manager = await getRole(t.db, managerId);
    expect(manager?.permissions).toEqual(
      [
        'contributions.read',
        'coverage.read',
        'dataset.read',
        'dataset.read_inactive',
        'imports.read',
        'records.annotate',
        'records.create',
        'records.review',
        'records.withdraw',
        'taxa.propose',
      ].sort(),
    );

    const adminId = await systemRoleId(t.db, 'admin');
    const admin = await getRole(t.db, adminId);
    expect(admin?.permissions).toEqual([...PERMISSION_KEYS].sort());
  });

  it('deletes a role, cascading assignments, auditing and invalidating holders', async () => {
    const role = await createRole(ctx(), {
      name: uniq(),
      permissions: ['users.read'],
      actorUserId: null,
    });
    const { user } = await createUser(t.db, { roles: [role.id] });
    await resolvePermissions(ctx(), user.id);
    await deleteRole(ctx(), { id: role.id, actorUserId: null });
    expect(await getRole(t.db, role.id)).toBeNull();
    expect([...(await resolvePermissions(ctx(), user.id))]).toEqual([]);
    expect(await lastAudit(t.db, 'roles.deleted', { targetId: role.id })).toMatchObject({
      targetId: role.id,
    });
    expect(await code(deleteRole(ctx(), { id: role.id, actorUserId: null }))).toBe(
      'ROLE_NOT_FOUND',
    );
  });

  it('listRoles returns every role by name with permissions', async () => {
    const name = uniq();
    await createRole(ctx(), { name, permissions: ['roles.read'], actorUserId: null });
    const list = await listRoles(t.db);
    expect(list.find((r) => r.name === name)?.permissions).toEqual(['roles.read']);
    expect(list.map((r) => r.name.toLowerCase())).toEqual(
      [...list.map((r) => r.name.toLowerCase())].sort(),
    );
    expect(list.find((r) => r.name === 'admin')?.isSystem).toBe(true);
  });
});

describe('RFC-31 R6, R7 assignment and anti-lockout', () => {
  const t = useTestApp();
  const ctx = () => ({
    db: t.db,
    permissionCache: t.permissionCache,
    logger: t.deps.logger,
    now: () => t.clock.now,
  });

  it('setUserRoles replaces the set, audits added/removed and invalidates the user', async () => {
    const r1 = await insertRole(t.db, { permissions: ['users.read'] });
    const r2 = await insertRole(t.db, { permissions: ['audit.read'] });
    const { user } = await createUser(t.db, { roles: [r1.id] });
    await resolvePermissions(ctx(), user.id);
    const result = await setUserRoles(ctx(), {
      userId: user.id,
      roleIds: [r2.id],
      actorUserId: null,
    });
    expect(result).toEqual({ added: [r2.id], removed: [r1.id] });
    expect([...(await resolvePermissions(ctx(), user.id))]).toEqual(['audit.read']);
    expect(await lastAudit(t.db, 'users.roles_changed', { targetId: user.id })).toMatchObject({
      targetType: 'user',
      targetId: user.id,
      metadata: { added: [r2.id], removed: [r1.id] },
    });
    expect(
      await code(
        setUserRoles(ctx(), {
          userId: user.id,
          roleIds: ['019b4a2e-5f3c-7c8e-8d1a-2f3b4c5d6e7f'],
          actorUserId: null,
        }),
      ),
    ).toBe('ROLE_NOT_FOUND');
    expect(
      await code(
        setUserRoles(ctx(), {
          userId: '019b4a2e-5f3c-7c8e-8d1a-2f3b4c5d6e7f',
          roleIds: [],
          actorUserId: null,
        }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('the last active admin cannot lose the role; suspended admins do not count; two admins may', async () => {
    // Runs in a rolled-back transaction that locks user_roles, so admins created by
    // other test files (in parallel workers) cannot change the count mid-test.
    await withRollback(t.db, async (tx) => {
      await tx.execute(sql`lock table user_roles in exclusive mode`);
      const admin = await adminRoleId(tx);
      await tx.delete(userRoles).where(eq(userRoles.roleId, admin));
      const c = {
        db: tx,
        permissionCache: t.permissionCache,
        logger: t.deps.logger,
        now: () => t.clock.now,
      };
      const a = await createUser(tx, { roles: [admin] });
      expect(
        await code(setUserRoles(c, { userId: a.user.id, roleIds: [], actorUserId: null })),
      ).toBe('ROLE_LAST_ADMIN');
      expect(await code(assertNotLastAdmin(tx, a.user.id))).toBe('ROLE_LAST_ADMIN');
      const suspended = await createUser(tx, { status: 'suspended', roles: [admin] });
      expect(
        await code(setUserRoles(c, { userId: a.user.id, roleIds: [], actorUserId: null })),
      ).toBe('ROLE_LAST_ADMIN');
      expect(await code(assertNotLastAdmin(tx, suspended.user.id))).toBe('ok');
      const b = await createUser(tx, { roles: [admin] });
      expect(await code(assertNotLastAdmin(tx, a.user.id))).toBe('ok');
      expect(
        await code(setUserRoles(c, { userId: a.user.id, roleIds: [], actorUserId: null })),
      ).toBe('ok');
      expect(
        await code(setUserRoles(c, { userId: b.user.id, roleIds: [], actorUserId: null })),
      ).toBe('ROLE_LAST_ADMIN');
      const nobody = await createUser(tx);
      expect(await code(assertNotLastAdmin(tx, nobody.user.id))).toBe('ok');
    });
  });

  it('two concurrent removals of admin from the last two admins cannot both succeed', async () => {
    // Other test files may hold active admins of their own (they only ever add
    // them), so the expectation depends on how many exist besides the two here.
    const admin = await adminRoleId(t.db);
    const a = await createUser(t.db, { roles: [admin] });
    const b = await createUser(t.db, { roles: [admin] });
    const pair = [a.user.id, b.user.id];
    const activeAdmins = async (db: DbExecutor, exclude: string[]) =>
      (
        await db
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .innerJoin(users, eq(users.id, userRoles.userId))
          .where(
            and(
              eq(userRoles.roleId, admin),
              eq(users.status, 'active'),
              exclude.length > 0 ? notInArray(userRoles.userId, exclude) : undefined,
            ),
          )
      ).map((r) => r.userId);
    const second = createDb(inject('databaseUrl'), { max: 3 });
    try {
      await second.db.execute(sql`select 1`); // connect now, so both calls start together
      const othersBefore = (await activeAdmins(t.db, pair)).length;
      const results = await Promise.allSettled([
        setUserRoles(ctx(), { userId: a.user.id, roleIds: [], actorUserId: null }),
        setUserRoles(
          { ...ctx(), db: second.db },
          { userId: b.user.id, roleIds: [], actorUserId: null },
        ),
      ]);
      const othersAfter = (await activeAdmins(t.db, pair)).length;
      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason instanceof AppError ? r.reason.code : String(r.reason)));
      const remaining = (await activeAdmins(t.db, [])).filter((id) => pair.includes(id));
      expect(failures.every((c) => c === 'ROLE_LAST_ADMIN')).toBe(true);
      expect(failures.length).toBeLessThanOrEqual(1);
      expect(remaining.length).toBe(failures.length);
      if (othersBefore === 0 && othersAfter === 0) expect(failures).toEqual(['ROLE_LAST_ADMIN']);
      if (othersBefore > 0) expect(failures).toEqual([]);
    } finally {
      await second.close();
      await t.db.delete(userRoles).where(inArray(userRoles.userId, pair));
    }
  });
});

describe('RFC-31 R12, R13, R14 delegation ceiling and self-change', () => {
  const t = useTestApp();
  const ctx = () => ({
    db: t.db,
    permissionCache: t.permissionCache,
    logger: t.deps.logger,
    now: () => t.clock.now,
  });
  /** A `users.update` + `roles.manage` holder: the actor the ceiling exists for. */
  const delegator = async () => {
    const role = await insertRole(t.db, {
      permissions: ['users.update', 'roles.manage', 'users.read', 'audit.read'],
    });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, role };
  };

  it('R12 a non-admin actor cannot grant the admin role, and the refusal is audited', async () => {
    const { user: actor } = await delegator();
    const { user: target } = await createUser(t.db);
    const admin = await adminRoleId(t.db);
    expect(
      await code(
        setUserRoles(ctx(), { userId: target.id, roleIds: [admin], actorUserId: actor.id }),
      ),
    ).toBe('PERMISSION_DENIED');
    expect(await userIdsWithRole(t.db, admin)).not.toContain(target.id);
    expect(
      await lastAudit(t.db, 'roles.delegation_refused', { targetId: target.id }),
    ).toMatchObject({
      actorUserId: actor.id,
      targetType: 'user',
      metadata: { reason: 'admin_role', added: [admin], removed: [] },
    });
    expect(await lastAudit(t.db, 'users.roles_changed', { targetId: target.id })).toBeUndefined();
  });

  it('R12 a non-admin actor cannot remove the admin role either', async () => {
    const { user: actor } = await delegator();
    const admin = await adminRoleId(t.db);
    const { user: target } = await createUser(t.db, { roles: [admin] });
    expect(
      await code(setUserRoles(ctx(), { userId: target.id, roleIds: [], actorUserId: actor.id })),
    ).toBe('PERMISSION_DENIED');
    expect(await userIdsWithRole(t.db, admin)).toContain(target.id);
    expect(
      await lastAudit(t.db, 'roles.delegation_refused', { targetId: target.id }),
    ).toMatchObject({ metadata: { reason: 'admin_role', added: [], removed: [admin] } });
  });

  it('R12 an admin actor grants admin', async () => {
    const admin = await adminRoleId(t.db);
    const { user: actor } = await createUser(t.db, { roles: [admin] });
    const { user: target } = await createUser(t.db);
    await setUserRoles(ctx(), { userId: target.id, roleIds: [admin], actorUserId: actor.id });
    expect(await userIdsWithRole(t.db, admin)).toContain(target.id);
  });

  it('R12 a role is assigned only within the actor’s permissions; removal is never limited', async () => {
    const { user: actor } = await delegator();
    const within = await insertRole(t.db, { permissions: ['users.read'] });
    const beyond = await insertRole(t.db, { permissions: ['users.read', 'dataset.export'] });
    const { user: target } = await createUser(t.db, { roles: [beyond.id] });
    expect(
      await code(
        setUserRoles(ctx(), {
          userId: target.id,
          roleIds: [beyond.id, within.id],
          actorUserId: actor.id,
        }),
      ),
    ).toBe('ok');
    const { user: other } = await createUser(t.db);
    expect(
      await code(
        setUserRoles(ctx(), { userId: other.id, roleIds: [beyond.id], actorUserId: actor.id }),
      ),
    ).toBe('PERMISSION_DENIED');
    expect(await lastAudit(t.db, 'roles.delegation_refused', { targetId: other.id })).toMatchObject(
      { metadata: { reason: 'ceiling', added: [beyond.id], removed: [] } },
    );
    expect(await userIdsWithRole(t.db, beyond.id)).not.toContain(other.id);
    expect(
      await code(setUserRoles(ctx(), { userId: target.id, roleIds: [], actorUserId: actor.id })),
    ).toBe('ok');
    expect(await userIdsWithRole(t.db, beyond.id)).not.toContain(target.id);
  });

  it('R13 an actor never changes their own roles, even to the same set', async () => {
    const { user: actor, role } = await delegator();
    expect(
      await code(
        setUserRoles(ctx(), { userId: actor.id, roleIds: [role.id], actorUserId: actor.id }),
      ),
    ).toBe('PERMISSION_DENIED');
    expect(await lastAudit(t.db, 'roles.delegation_refused', { targetId: actor.id })).toMatchObject(
      { actorUserId: actor.id, metadata: { reason: 'own_roles' } },
    );
    const admin = await adminRoleId(t.db);
    const { user: adminActor } = await createUser(t.db, { roles: [admin] });
    expect(
      await code(
        setUserRoles(ctx(), {
          userId: adminActor.id,
          roleIds: [admin],
          actorUserId: adminActor.id,
        }),
      ),
    ).toBe('PERMISSION_DENIED');
  });

  it('R13 an actor never changes the permission set of a role they hold, but may rename it; an admin may', async () => {
    const { user: actor, role } = await delegator();
    expect(
      await code(
        updateRole(ctx(), { id: role.id, permissions: ['users.read'], actorUserId: actor.id }),
      ),
    ).toBe('PERMISSION_DENIED');
    expect((await getRole(t.db, role.id))?.permissions).toContain('roles.manage');
    expect(await lastAudit(t.db, 'roles.delegation_refused', { targetId: role.id })).toMatchObject({
      actorUserId: actor.id,
      targetType: 'role',
      metadata: { reason: 'held_role' },
    });
    expect(
      await code(updateRole(ctx(), { id: role.id, description: 'mine', actorUserId: actor.id })),
    ).toBe('ok');
    const { user: adminActor } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    expect(
      await code(
        updateRole(ctx(), { id: role.id, permissions: ['users.read'], actorUserId: adminActor.id }),
      ),
    ).toBe('ok');
  });

  it('R12 updateRole adds only permissions the actor holds; a permission the actor lacks may stay or go', async () => {
    const { user: actor } = await delegator();
    const role = await insertRole(t.db, { permissions: ['health.read'] });
    expect(
      await code(
        updateRole(ctx(), {
          id: role.id,
          permissions: ['health.read', 'traits.manage'],
          actorUserId: actor.id,
        }),
      ),
    ).toBe('PERMISSION_DENIED');
    expect(await lastAudit(t.db, 'roles.delegation_refused', { targetId: role.id })).toMatchObject({
      targetType: 'role',
      metadata: { reason: 'ceiling' },
    });
    expect((await getRole(t.db, role.id))?.permissions).toEqual(['health.read']);
    expect(
      await code(
        updateRole(ctx(), {
          id: role.id,
          permissions: ['health.read', 'users.read'],
          actorUserId: actor.id,
        }),
      ),
    ).toBe('ok');
    expect(
      await code(updateRole(ctx(), { id: role.id, permissions: [], actorUserId: actor.id })),
    ).toBe('ok');
  });

  it('R12 createRole writes only permissions the actor holds', async () => {
    const { user: actor } = await delegator();
    expect(
      await code(
        createRole(ctx(), {
          name: uniq(),
          permissions: ['users.read', 'traits.manage'],
          actorUserId: actor.id,
        }),
      ),
    ).toBe('PERMISSION_DENIED');
    expect(
      await lastAudit(t.db, 'roles.delegation_refused', { actorUserId: actor.id }),
    ).toMatchObject({ targetType: 'role', targetId: null, metadata: { reason: 'ceiling' } });
    const role = await createRole(ctx(), {
      name: uniq(),
      permissions: ['users.read'],
      actorUserId: actor.id,
    });
    expect(role.permissions).toEqual(['users.read']);
  });

  it('R14 the resource errors come first: an unknown user, role or a system role answers 404 / 409, not 403', async () => {
    const { user: actor, role } = await delegator();
    const unknown = '019b4a2e-5f3c-7c8e-8d1a-2f3b4c5d6e7f';
    expect(
      await code(
        setUserRoles(ctx(), { userId: actor.id, roleIds: [unknown], actorUserId: actor.id }),
      ),
    ).toBe('ROLE_NOT_FOUND');
    expect(
      await code(setUserRoles(ctx(), { userId: unknown, roleIds: [], actorUserId: actor.id })),
    ).toBe('NOT_FOUND');
    expect(
      await code(
        updateRole(ctx(), { id: unknown, permissions: ['users.read'], actorUserId: actor.id }),
      ),
    ).toBe('ROLE_NOT_FOUND');
    expect(
      await code(
        updateRole(ctx(), {
          id: await adminRoleId(t.db),
          permissions: ['users.read'],
          actorUserId: actor.id,
        }),
      ),
    ).toBe('ROLE_IS_SYSTEM');
    expect(
      await lastAudit(t.db, 'roles.delegation_refused', { actorUserId: actor.id }),
    ).toBeUndefined();
    expect((await getRole(t.db, role.id))?.permissions).toContain('roles.manage');
  });

  it('R12 the null actor (CLI) is unrestricted', async () => {
    const admin = await adminRoleId(t.db);
    const { user: target } = await createUser(t.db);
    await setUserRoles(ctx(), { userId: target.id, roleIds: [admin], actorUserId: null });
    expect(await userIdsWithRole(t.db, admin)).toContain(target.id);
    // Every key a custom role may hold (R15 keeps the admin-only ones out).
    const all = PERMISSION_KEYS.filter((k) => !ADMIN_ONLY_PERMISSIONS.includes(k));
    const role = await createRole(ctx(), { name: uniq(), permissions: all, actorUserId: null });
    expect(role.permissions).toEqual([...all].sort());
  });
});
