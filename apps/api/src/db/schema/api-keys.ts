import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Personal API keys. Only the SHA-256 of a key is stored; rows are never
 * deleted (revocation sets `revoked_at`), so the runtime role holds no DELETE.
 * @rfc RFC-82 R1
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
    index('api_keys_user_idx').on(t.userId, t.createdAt),
  ],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
