import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { permissions } from './permissions.ts';
import { roles } from './roles.ts';

/** @rfc RFC-31 R1 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);
