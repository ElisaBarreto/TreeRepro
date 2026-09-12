import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../types/encrypted-text.ts';
import { users } from './users.ts';

/**
 * @rfc RFC-41 R1, R4
 * @rfc RFC-02 R8
 * @rfc RFC-20 R9
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: encryptedText('audit_log', 'ip'),
    userAgent: encryptedText('audit_log', 'user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at.desc()),
    index('audit_log_actor_idx').on(t.actorUserId, t.at.desc()),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
