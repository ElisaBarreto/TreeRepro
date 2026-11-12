import type { Platform } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { PLATFORMS_SQL } from './user-roles.ts';
import { users } from './users.ts';

/** @rfc RFC-20 R5 */
export const AUTH_TOKEN_KINDS = ['invite', 'password_reset'] as const;
export type AuthTokenKind = (typeof AUTH_TOKEN_KINDS)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** @rfc RFC-20 R5 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: AUTH_TOKEN_KINDS }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** An invite's platform; null on a reset, and on an invite older than 0057 (= treerepro). */
    platform: text('platform').$type<Platform>(),
  },
  (t) => [
    uniqueIndex('auth_tokens_token_hash_idx').on(t.tokenHash),
    index('auth_tokens_user_kind_idx').on(t.userId, t.kind),
    check('auth_tokens_kind_check', sql`${t.kind} in ('invite', 'password_reset')`),
    check('auth_tokens_platform_check', sql`${t.platform} in (${PLATFORMS_SQL})`),
  ],
);

export type AuthTokenRow = typeof authTokens.$inferSelect;
