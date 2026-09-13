import { TRAIT_VALUE_TYPES } from '@treerepro/contracts';
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

/** @rfc RFC-62 R1 */
export const traitCategories = pgTable('trait_categories', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** @rfc RFC-62 R1, R3 */
export const traits = pgTable(
  'traits',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    key: text('key').notNull(),
    categoryKey: text('category_key')
      .notNull()
      .references(() => traitCategories.key, { onDelete: 'restrict' }),
    valueType: text('value_type', { enum: TRAIT_VALUE_TYPES }).notNull(),
    unit: text('unit'),
    description: text('description').notNull().default(''),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('traits_key_idx').on(t.key),
    index('traits_category_idx').on(t.categoryKey),
    check('traits_value_type_check', sql`${t.valueType} in ('categorical', 'quantitative')`),
  ],
);

/** @rfc RFC-62 R1, R3, R4 */
export const traitLevels = pgTable(
  'trait_levels',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    traitId: uuid('trait_id')
      .notNull()
      .references(() => traits.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [uniqueIndex('trait_levels_trait_key_idx').on(t.traitId, sql`lower(${t.key})`)],
);

export type TraitCategoryRow = typeof traitCategories.$inferSelect;
export type TraitRow = typeof traits.$inferSelect;
export type TraitLevelRow = typeof traitLevels.$inferSelect;
