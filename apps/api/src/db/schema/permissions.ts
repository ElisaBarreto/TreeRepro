import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** @rfc RFC-30 R3 */
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
