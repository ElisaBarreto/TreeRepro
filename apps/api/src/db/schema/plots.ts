import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { species } from './taxa.ts';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** @rfc RFC-67 R1 */
export const plots = pgTable(
  'plots',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    country: text('country'),
    biome: text('biome'),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('plots_code_lower_idx').on(sql`lower(${t.code})`),
    check('plots_latitude_check', sql`${t.latitude} is null or ${t.latitude} between -90 and 90`),
    check(
      'plots_longitude_check',
      sql`${t.longitude} is null or ${t.longitude} between -180 and 180`,
    ),
  ],
);

/** @rfc RFC-67 R1 */
export const plotSpecies = pgTable(
  'plot_species',
  {
    plotId: uuid('plot_id')
      .notNull()
      .references(() => plots.id, { onDelete: 'restrict' }),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.plotId, t.speciesId] }),
    index('plot_species_species_idx').on(t.speciesId),
  ],
);

/** @rfc RFC-67 R1 */
export const userPlots = pgTable(
  'user_plots',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    plotId: uuid('plot_id')
      .notNull()
      .references(() => plots.id, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.plotId] }), index('user_plots_plot_idx').on(t.plotId)],
);

export type PlotRow = typeof plots.$inferSelect;
export type NewPlotRow = typeof plots.$inferInsert;
export type PlotSpeciesRow = typeof plotSpecies.$inferSelect;
export type UserPlotRow = typeof userPlots.$inferSelect;
