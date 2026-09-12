import { PERMISSION_KEYS } from '@treerepro/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { withRollback } from '../../test/helpers/db.ts';
import { adminRoleId, createRole as insertRole } from '../../test/helpers/roles.ts';
import { createUser } from '../../test/helpers/users.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { userRoles } from '../db/schema/user-roles.ts';
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

async function lastAudit(t: ReturnType<typeof useTestApp>, action: string) {
  const [row] = await t.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, action))
    .orderBy(desc(auditLog.id))
    .limit(1);
  return row;
}

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
    const { user: actor } = await createUser(t.db);
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
    expect(await lastAudit(t, 'roles.created')).toMatchObject({
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
    expect(await lastAudit(t, 'roles.updated')).toMatchObject({
      targetId: role.id,
      metadata: { changes: ['description', 'permissions'] },
    });
    expect([...(await resolvePermissions(ctx(), a.user.id))]).toEqual(['audit.read']);
    expect([...(await resolvePermissions(ctx(), b.user.id))]).toEqual(['audit.read']);
    expect((await userIdsWithRole(t.db, role.id)).sort()).toEqual([a.user.id, b.user.id].sort());
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
    expect(await lastAudit(t, 'roles.deleted')).toMatchObject({ targetId: role.id });
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
    expect(await lastAudit(t, 'users.roles_changed')).toMatchObject({
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
});
