import { PERMISSION_KEYS, PERMISSIONS } from '@treerepro/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { permissions } from './permissions.ts';
import { rolePermissions } from './role-permissions.ts';
import { ADMIN_ROLE_NAME, roles } from './roles.ts';
import { userRoles } from './user-roles.ts';

describe('RFC-30 R3 permissions table', () => {
  const t = useTestDb();

  it('holds exactly the catalog', async () => {
    const rows = await t.db.select().from(permissions);
    expect(Object.fromEntries(rows.map((r) => [r.key, r.description]))).toEqual(PERMISSIONS);
    expect(rows.map((r) => r.key).sort()).toEqual([...PERMISSION_KEYS].sort());
  });
});

describe('RFC-31 R1, R2 roles tables', () => {
  const t = useTestDb();

  it('the admin system role exists with no stored permissions', async () => {
    const [admin] = await t.db.select().from(roles).where(eq(roles.name, ADMIN_ROLE_NAME));
    expect(admin?.isSystem).toBe(true);
    const stored = await t.db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, admin?.id ?? ''));
    expect(stored).toHaveLength(0);
  });

  it('role names are unique case-insensitively', async () => {
    await withRollback(t.db, async (tx) => {
      await tx.insert(roles).values({ name: 'Editors' });
      await expect(
        unwrapDbError(tx.transaction((sp) => sp.insert(roles).values({ name: 'editors' }))),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('role_permissions references the catalog and cascades on role delete; user_roles cascades too', async () => {
    await withRollback(t.db, async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ name: `r-${Math.random().toString(16).slice(2)}` })
        .returning();
      const roleId = role?.id ?? '';
      await tx.insert(rolePermissions).values({ roleId, permissionKey: 'users.read' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(rolePermissions).values({ roleId, permissionKey: 'users.fly' as never }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23503' });
      const { user } = await createUser(tx);
      await tx.insert(userRoles).values({ userId: user.id, roleId });
      await tx.delete(roles).where(eq(roles.id, roleId));
      const [rp] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      const [ur] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(userRoles)
        .where(eq(userRoles.roleId, roleId));
      expect(rp?.n).toBe(0);
      expect(ur?.n).toBe(0);
    });
  });

  it('R2, R10 manager and contributor are system roles with the seeded permissions', async () => {
    const rows = await t.db
      .select()
      .from(roles)
      .where(inArray(roles.name, ['manager', 'contributor']));
    expect(rows.map((r) => r.isSystem)).toEqual([true, true]);
    const byName = new Map(rows.map((r) => [r.name, r.id]));
    const keys = async (name: string) =>
      (
        await t.db
          .select({ key: rolePermissions.permissionKey })
          .from(rolePermissions)
          .where(eq(rolePermissions.roleId, byName.get(name) ?? ''))
      )
        .map((r) => r.key)
        .sort();
    expect(await keys('contributor')).toEqual([
      'dataset.read',
      'records.annotate',
      'records.create',
      'taxa.propose',
    ]);
    expect(await keys('manager')).toEqual([
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
    ]);
  });
});
