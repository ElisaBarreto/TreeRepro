import { NAME_SOURCES } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** @rfc RFC-60 R1, R5 */
export const families = pgTable(
  'families',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [uniqueIndex('families_name_idx').on(t.name)],
);

/** @rfc RFC-60 R1, R3, R5 */
export const genera = pgTable(
  'genera',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    familyId: uuid('family_id').references(() => families.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [uniqueIndex('genera_name_idx').on(t.name), index('genera_family_idx').on(t.familyId)],
);

/**
 * `traitCount` is the number of `species_trait_coverage` rows for the species,
 * maintained by the same `trait_records` insert trigger (RFC-69 R1, R2); its
 * index carries `canonicalName` and `id` so the species list can sort on
 * coverage and page with a keyset cursor.
 * @rfc RFC-60 R1, R3, R6
 * @rfc RFC-69 R1
 */
export const species = pgTable(
  'species',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    genusId: uuid('genus_id').references(() => genera.id, { onDelete: 'restrict' }),
    canonicalName: text('canonical_name').notNull(),
    nameSource: text('name_source', { enum: NAME_SOURCES }).notNull(),
    active: boolean('active').notNull().default(true),
    traitCount: integer('trait_count').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('species_canonical_name_idx').on(t.canonicalName),
    index('species_canonical_name_trgm_idx').using('gin', sql`${t.canonicalName} gin_trgm_ops`),
    index('species_genus_idx').on(t.genusId),
    index('species_trait_count_idx').on(t.traitCount, t.canonicalName, t.id),
    check('species_name_source_check', sql`${t.nameSource} in ('wcvp', 'gbif', 'original')`),
  ],
);

/** @rfc RFC-60 R1, R4 */
export const speciesNames = pgTable(
  'species_names',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    source: text('source', { enum: ['gbif'] })
      .notNull()
      .default('gbif'),
    gbifUsageKey: text('gbif_usage_key'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('species_names_species_name_idx').on(t.speciesId, t.name),
    index('species_names_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

export type FamilyRow = typeof families.$inferSelect;
export type GenusRow = typeof genera.$inferSelect;
export type SpeciesRow = typeof species.$inferSelect;
export type SpeciesNameRow = typeof speciesNames.$inferSelect;
