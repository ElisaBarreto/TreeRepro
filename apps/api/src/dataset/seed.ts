import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import { DEFAULT_COPY_IDLE_TIMEOUT_MS, pipelineWithIdleGuard } from '../db/copy.ts';
import { parseCsvLine, readFirstLine } from './import.ts';

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

/** The six required columns, in file order. @rfc RFC-62 R2 */
const DICTIONARY_COLUMNS = [
  'final_standard_trait',
  'broad_category',
  'trait_value_type',
  'standard_unit',
  'description',
  'harmonised_levels',
] as const;

/**
 * True when the header carries the optional seventh `active` column; any
 * other header (missing, extra or differently named columns) is left to the
 * six-column COPY below and whatever error Postgres raises for it.
 * @rfc RFC-62 R2
 */
async function hasActiveColumn(csvPath: string): Promise<boolean> {
  const header = await readFirstLine(csvPath);
  const columns = parseCsvLine(header.replace(/^﻿/, '').replace(/\r$/, '')).map((c) => c.trim());
  return columns.length === DICTIONARY_COLUMNS.length + 1 && columns[6]?.toLowerCase() === 'active';
}

/**
 * Inserts the categories, traits and levels the database lacks; never updates.
 * Postgres parses the CSV (COPY into a temporary table), so no CSV parser is
 * needed in Node beyond reading the header line to detect the optional
 * `active` column.
 * @rfc RFC-62 R2
 */
export async function seedDictionary(
  db: Db,
  csvPath = dictionaryPath(),
  options: SeedOptions = {},
): Promise<SeedReport> {
  const sql = db.$client;
  const withActive = await hasActiveColumn(csvPath);
  return sql.begin(async (tx): Promise<SeedReport> => {
    await tx`
      create temporary table dictionary_staging (
        row_no bigserial,
        final_standard_trait text,
        broad_category text,
        trait_value_type text,
        standard_unit text,
        description text,
        harmonised_levels text,
        active text
      ) on commit drop`;
    const writable = await (withActive
      ? tx`
          copy dictionary_staging (final_standard_trait, broad_category, trait_value_type, standard_unit, description, harmonised_levels, active)
          from stdin with (format csv, header true, encoding 'UTF8')`
      : tx`
          copy dictionary_staging (final_standard_trait, broad_category, trait_value_type, standard_unit, description, harmonised_levels)
          from stdin with (format csv, header true, encoding 'UTF8')`
    ).writable();
    await pipelineWithIdleGuard(
      createReadStream(csvPath),
      writable,
      options.copyIdleTimeoutMs ?? DEFAULT_COPY_IDLE_TIMEOUT_MS,
    );

    if (withActive) {
      // Refuse before any insert: an empty cell defaults to true below, but
      // anything else that isn't true/false (case-insensitively) is invalid.
      const [invalid] = (await tx`
        select (row_no + 1)::int as line
        from dictionary_staging
        where trim(active) <> '' and lower(trim(active)) not in ('true', 'false')
        order by row_no
        limit 1`) as { line: number }[];
      if (invalid) throw new Error(`Invalid active value on line ${invalid.line}`);
    }

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
      insert into traits (key, category_key, value_type, unit, description, active)
      select trim(final_standard_trait), trim(broad_category), trim(trait_value_type),
             nullif(trim(standard_unit), ''), coalesce(description, ''),
             coalesce(case lower(trim(active)) when 'true' then true when 'false' then false end, true)
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
