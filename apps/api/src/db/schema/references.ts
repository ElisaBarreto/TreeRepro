import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * `references` is a reserved word in SQL, hence the longer table name; the API
 * path stays `/api/references`.
 *
 * `primary_count` / `secondary_count` are the records naming the reference in
 * each role, maintained by the `trait_records_reference_usage` statement
 * trigger on every insert into `trait_records` (migration 0015) — records are
 * append-only, so the counters never go down. `usage_count` is their stored
 * sum, the list's sort key, indexed with `id` for the keyset cursor.
 * @rfc RFC-61 R1, R2, R4, R5
 */
export const bibliographicReferences = pgTable(
  'bibliographic_references',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    citationKey: text('citation_key').notNull(),
    title: text('title'),
    authors: text('authors'),
    year: smallint('year'),
    journal: text('journal'),
    doi: text('doi'),
    url: text('url'),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
    primaryCount: integer('primary_count').notNull().default(0),
    secondaryCount: integer('secondary_count').notNull().default(0),
    usageCount: integer('usage_count')
      .notNull()
      .generatedAlwaysAs(sql`primary_count + secondary_count`),
  },
  (t) => [
    uniqueIndex('bibliographic_references_citation_key_idx').on(t.citationKey),
    index('bibliographic_references_usage_idx').on(t.usageCount.desc(), t.id.desc()),
    uniqueIndex('bibliographic_references_doi_idx').on(t.doi).where(sql`${t.doi} is not null`),
    index('bibliographic_references_citation_key_trgm_idx').using(
      'gin',
      sql`${t.citationKey} gin_trgm_ops`,
    ),
  ],
);

export type ReferenceRow = typeof bibliographicReferences.$inferSelect;
