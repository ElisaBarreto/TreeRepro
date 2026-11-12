import { PLATFORMS, type Platform } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { roles } from './roles.ts';
import { users } from './users.ts';

/** `'treerepro', 'plantrepro'` for a check constraint. @rfc RFC-14 R1 */
export const PLATFORMS_SQL = sql.raw(PLATFORMS.map((p) => `'${p}'`).join(', '));

/**
 * One row per role a user holds on a platform; `admin` is stored once per
 * platform (RFC-31 R16).
 * @rfc RFC-31 R1, R16
 */
export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<Platform>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId, t.platform] }),
    check('user_roles_platform_check', sql`${t.platform} in (${PLATFORMS_SQL})`),
  ],
);
