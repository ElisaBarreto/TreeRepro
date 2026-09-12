import { randomBytes } from 'node:crypto';
import type { PermissionKey } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../src/db/client.ts';
import { rolePermissions } from '../../src/db/schema/role-permissions.ts';
import { ADMIN_ROLE_NAME, type RoleRow, roles } from '../../src/db/schema/roles.ts';
import { userRoles } from '../../src/db/schema/user-roles.ts';

export interface CreateRoleOptions {
  name?: string;
  permissions?: PermissionKey[];
  isSystem?: boolean;
}

/** Inserts a role and its permissions directly (the services have their own tests). */
export async function createRole(
  db: DbExecutor,
  options: CreateRoleOptions = {},
): Promise<RoleRow> {
  const [role] = await db
    .insert(roles)
    .values({
      name: options.name ?? `role-${randomBytes(4).toString('hex')}`,
      isSystem: options.isSystem ?? false,
    })
    .returning();
  if (!role) throw new Error('createRole: insert returned no row');
  if (options.permissions?.length) {
    await db
      .insert(rolePermissions)
      .values(options.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })));
  }
  return role;
}

export async function grantRoles(db: DbExecutor, userId: string, roleIds: string[]): Promise<void> {
  if (roleIds.length === 0) return;
  await db
    .insert(userRoles)
    .values(roleIds.map((roleId) => ({ userId, roleId })))
    .onConflictDoNothing();
}

export async function adminRoleId(db: DbExecutor): Promise<string> {
  const [row] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, ADMIN_ROLE_NAME));
  if (!row) throw new Error('admin role missing: is migration 0004 applied?');
  return row.id;
}
