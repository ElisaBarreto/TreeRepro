import { USER_STATUSES } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from '../types/encrypted-text.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * @rfc RFC-20 R1, R3
 * @rfc RFC-40 R1
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    email: encryptedText('users', 'email').notNull(),
    emailHash: text('email_hash').notNull(),
    name: encryptedText('users', 'name').notNull(),
    passwordHash: text('password_hash'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('invited'),
    totpSecret: encryptedText('users', 'totp_secret'),
    totpEnabledAt: ts('totp_enabled_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    suspendedAt: ts('suspended_at'),
  },
  (t) => [
    uniqueIndex('users_email_hash_idx').on(t.emailHash),
    check('users_status_check', sql`${t.status} in ('invited', 'active', 'suspended')`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
