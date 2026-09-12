import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { roles } from './roles.ts';
import { users } from './users.ts';

/** @rfc RFC-31 R1 */
export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);
