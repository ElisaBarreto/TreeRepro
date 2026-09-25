import { REFERENCE_KINDS } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
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
 *
 * `short_citation` (1–200 characters) and `full_citation` (1–2,000) hold the
 * display citation, written by a curator or derived from Crossref (RFC-61 R8);
 * the lengths are enforced by the contract, not by the column.
 *
 * A `book` (RFC-61 R10) carries `isbn`, the normalised ISBN-13 of
 * `isValidIsbn`, unique, and its citation in `full_citation`; no other kind
 * has an ISBN. Both are enforced by the checks below, not only by the contract.
 * @rfc RFC-61 R1, R2, R4, R5, R10
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
    kind: text('kind', { enum: REFERENCE_KINDS }).notNull().default('publication'),
    observerUserId: uuid('observer_user_id').references(() => users.id),
    shortCitation: text('short_citation'),
    fullCitation: text('full_citation'),
    isbn: text('isbn'),
  },
  (t) => [
    uniqueIndex('bibliographic_references_citation_key_idx').on(t.citationKey),
    index('bibliographic_references_usage_idx').on(t.usageCount.desc(), t.id.desc()),
    // On `lower(doi)`: a DOI is case-insensitive, so `10.1/X` and `10.1/x`
    // are the same reference. The same index serves the `lower(doi)` lookup
    // `findReferenceByDoi` makes and the collision `createReferenceFromDoi`
    // relies on (RFC-80 R5). `catalog.ts` maps the violation by this name.
    uniqueIndex('bibliographic_references_doi_idx')
      .on(sql`lower(${t.doi})`)
      .where(sql`${t.doi} is not null`),
    index('bibliographic_references_citation_key_trgm_idx').using(
      'gin',
      sql`${t.citationKey} gin_trgm_ops`,
    ),
    check(
      'bibliographic_references_kind_check',
      sql`${t.kind} in ('publication', 'book', 'personal_observation')`,
    ),
    check(
      'bibliographic_references_observer_check',
      sql`(${t.kind} = 'personal_observation') = (${t.observerUserId} is not null)`,
    ),
    uniqueIndex('bibliographic_references_observer_idx')
      .on(t.observerUserId)
      .where(sql`${t.kind} = 'personal_observation'`),
    uniqueIndex('bibliographic_references_isbn_idx').on(t.isbn),
    check(
      'bibliographic_references_book_check',
      sql`(${t.kind} = 'book') = (${t.isbn} is not null) and (${t.kind} <> 'book' or ${t.fullCitation} is not null)`,
    ),
    check('bibliographic_references_isbn_check', sql`${t.isbn} ~ '^97[89][0-9]{10}$'`),
  ],
);

export type ReferenceRow = typeof bibliographicReferences.$inferSelect;
