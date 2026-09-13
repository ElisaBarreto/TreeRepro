import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import { DEFAULT_COPY_IDLE_TIMEOUT_MS, pipelineWithIdleGuard } from '../db/copy.ts';

/** `apps/api/seed/trait-dictionary.csv`, next to `src/` in development and to `dist/` in the image. @rfc RFC-62 R2 */
export function dictionaryPath(): string {
  return fileURLToPath(new URL('../../seed/trait-dictionary.csv', import.meta.url));
}

export interface SeedReport {
  categories: number;
  traits: number;
  levels: number;
}

export interface SeedOptions {
  /** See `pipelineWithIdleGuard` in `db/copy.ts`. Default {@link DEFAULT_COPY_IDLE_TIMEOUT_MS}; tests lower it to fail fast. */
  copyIdleTimeoutMs?: number;
}

/**
 * Inserts the categories, traits and levels the database lacks; never updates.
 * Postgres parses the CSV (COPY into a temporary table), so no CSV parser is
 * needed in Node.
 * @rfc RFC-62 R2
 */
export async function seedDictionary(
  db: Db,
  csvPath = dictionaryPath(),
  options: SeedOptions = {},
): Promise<SeedReport> {
  const sql = db.$client;
  return sql.begin(async (tx): Promise<SeedReport> => {
    await tx`
      create temporary table dictionary_staging (
        row_no bigserial,
        final_standard_trait text,
        broad_category text,
        trait_value_type text,
        standard_unit text,
        description text,
        harmonised_levels text
      ) on commit drop`;
    const writable = await tx`
      copy dictionary_staging (final_standard_trait, broad_category, trait_value_type, standard_unit, description, harmonised_levels)
      from stdin with (format csv, header true, encoding 'UTF8')`.writable();
    await pipelineWithIdleGuard(
      createReadStream(csvPath),
      writable,
      options.copyIdleTimeoutMs ?? DEFAULT_COPY_IDLE_TIMEOUT_MS,
    );

    const categories = await tx`
      insert into trait_categories (key, label, sort_order)
      select trim(broad_category),
             initcap(replace(trim(broad_category), '_', ' ')),
             min(row_no)::int
      from dictionary_staging
      where trim(broad_category) <> ''
      group by trim(broad_category)
      on conflict (key) do nothing`;
    const traits = await tx`
      insert into traits (key, category_key, value_type, unit, description)
      select trim(final_standard_trait), trim(broad_category), trim(trait_value_type),
             nullif(trim(standard_unit), ''), coalesce(description, '')
      from dictionary_staging
      where trim(final_standard_trait) <> ''
      order by row_no
      on conflict (key) do nothing`;
    const levels = await tx`
      insert into trait_levels (trait_id, key, sort_order)
      select t.id, trim(l.key), l.ord::int
      from dictionary_staging s
      join traits t on t.key = trim(s.final_standard_trait)
      cross join lateral unnest(string_to_array(s.harmonised_levels, ';')) with ordinality as l(key, ord)
      where coalesce(s.harmonised_levels, '') <> '' and trim(l.key) <> ''
      order by s.row_no, l.ord
      on conflict (trait_id, lower(key)) do nothing`;
    return { categories: categories.count, traits: traits.count, levels: levels.count };
  });
}
