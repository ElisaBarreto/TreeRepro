import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  pgView,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * WCVP accepted species of the last `import:wcvp` load; `taxon_name` is stored
 * trimmed with whitespace collapsed, `file_order` is the line in `wcvp_names.csv`.
 * @rfc RFC-78 R1, R3
 */
export const wcvpSpecies = pgTable(
  'wcvp_species',
  {
    plantNameId: text('plant_name_id').primaryKey(),
    taxonName: text('taxon_name').notNull(),
    isTree: boolean('is_tree').notNull(),
    fileOrder: integer('file_order').notNull(),
  },
  (t) => [index('wcvp_species_taxon_name_idx').on(t.taxonName, t.fileOrder)],
);

/** WCVP / TDWG level-3 regions of the last load. @rfc RFC-78 R1, R5 */
export const wcvpRegions = pgTable('wcvp_regions', {
  areaCodeL3: text('area_code_l3').primaryKey(),
  name: text('name').notNull(),
});

/** Native, extant, non-doubtful occurrences of accepted species. @rfc RFC-78 R1, R4 */
export const wcvpDistribution = pgTable(
  'wcvp_distribution',
  {
    plantNameId: text('plant_name_id')
      .notNull()
      .references(() => wcvpSpecies.plantNameId),
    areaCodeL3: text('area_code_l3')
      .notNull()
      .references(() => wcvpRegions.areaCodeL3),
  },
  (t) => [
    primaryKey({ columns: [t.plantNameId, t.areaCodeL3] }),
    index('wcvp_distribution_area_idx').on(t.areaCodeL3),
  ],
);

/**
 * Platform species → WCVP accepted species: equal collapsed names, the first
 * homonym in WCVP file order; an unmatched species has no row.
 * @rfc RFC-78 R6
 */
export const wcvpSpeciesMatch = pgView('wcvp_species_match', {
  speciesId: uuid('species_id').notNull(),
  plantNameId: text('plant_name_id').notNull(),
}).as(sql`
  select distinct on (s.id) s.id as species_id, w.plant_name_id
  from species s
  join wcvp_species w on w.taxon_name = trim(regexp_replace(s.canonical_name, '\\s+', ' ', 'g'))
  order by s.id, w.file_order`);
