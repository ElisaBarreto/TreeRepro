import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** @rfc RFC-31 R2 */
export const ADMIN_ROLE_NAME = 'admin';
/** @rfc RFC-31 R2, R10 */
export const MANAGER_ROLE_NAME = 'manager';
/** @rfc RFC-31 R2, R10 */
export const CONTRIBUTOR_ROLE_NAME = 'contributor';
/** @rfc RFC-31 R2 */
export const SYSTEM_ROLE_NAMES = [
  ADMIN_ROLE_NAME,
  MANAGER_ROLE_NAME,
  CONTRIBUTOR_ROLE_NAME,
] as const;

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** @rfc RFC-31 R1 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('roles_name_lower_idx').on(sql`lower(${t.name})`)],
);

export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;
