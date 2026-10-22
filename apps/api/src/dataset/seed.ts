import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Sql, TransactionSql } from 'postgres';
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

/** The six required columns, in file order: the owner's v1 header. @rfc RFC-62 R2 */
const DICTIONARY_COLUMNS = [
  'standard_trait',
  'broad_category',
  'value_type',
  'standard_unit',
  'description',
  'harmonised_levels',
] as const;

/**
 * True when the header carries the optional seventh `active` column. The
 * first six names must be `DICTIONARY_COLUMNS` (case-sensitive) and a seventh,
 * if any, `active` (case-insensitive); anything else, the pre-v1
 * `final_standard_trait` header included, is refused before any row reaches
 * COPY. (COPY's own `HEADER MATCH` would refuse it too, but a refused COPY can
 * hang the driver: docs/gotchas/import.md.)
 * @rfc RFC-62 R2
 */
async function hasActiveColumn(csvPath: string): Promise<boolean> {
  const header = await readFirstLine(csvPath);
  const columns = parseCsvLine(header.replace(/^\uFEFF/, '').replace(/\r$/, '')).map((c) =>
    c.trim(),
  );
  const sameFirstSix = DICTIONARY_COLUMNS.every((name, i) => columns[i] === name);
  if (columns.length === DICTIONARY_COLUMNS.length && sameFirstSix) return false;
  if (columns.length !== DICTIONARY_COLUMNS.length + 1) {
    throw new Error(
      `Unexpected header. Expected: ${DICTIONARY_COLUMNS.join(',')}. Got: ${columns.join(',')}`,
    );
  }
  if (!sameFirstSix || columns[6]?.toLowerCase() !== 'active') {
    throw new Error(
      `Unexpected header. Expected: ${DICTIONARY_COLUMNS.join(',')},active. Got: ${columns.join(',')}`,
    );
  }
  return true;
}

/** A dictionary row that describes a trait: not a `taxonomy`, `reference` or `record` column of the dataset file. @rfc RFC-62 R2 */
const traitRow = (tx: TransactionSql | Sql) =>
  tx`trim(standard_trait) <> '' and lower(trim(broad_category)) not in ('taxonomy', 'reference', 'record')`;

/**
 * Streams the dictionary file into `dictionary_staging`, a temporary table
 * dropped at commit. Postgres parses the CSV and checks the header names.
 * @rfc RFC-62 R2
 */
async function stageDictionary(
  tx: TransactionSql | Sql,
  csvPath: string,
  options: SeedOptions,
): Promise<void> {
  const withActive = await hasActiveColumn(csvPath);
  await tx`
    create temporary table dictionary_staging (
      row_no bigserial,
      standard_trait text,
      broad_category text,
      value_type text,
      standard_unit text,
      description text,
      harmonised_levels text,
      active text
    ) on commit drop`;
  const writable = await (withActive
    ? tx`
        copy dictionary_staging (standard_trait, broad_category, value_type, standard_unit, description, harmonised_levels, active)
        from stdin with (format csv, header true, encoding 'UTF8')`
    : tx`
        copy dictionary_staging (standard_trait, broad_category, value_type, standard_unit, description, harmonised_levels)
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
}

/**
 * Inserts the categories, traits and levels the database lacks, from the
 * staged file; with `update`, also rewrites the ones it has (RFC-62 R9).
 * @rfc RFC-62 R2, R9
 */
async function upsertDictionary(tx: TransactionSql | Sql, update: boolean): Promise<SeedReport> {
  const onCategory = update
    ? tx`do update set label = excluded.label, sort_order = excluded.sort_order`
    : tx`do nothing`;
  const onTrait = update
    ? tx`do update set category_key = excluded.category_key, value_type = excluded.value_type,
        unit = excluded.unit, description = excluded.description, active = excluded.active`
    : tx`do nothing`;
  const onLevel = update
    ? tx`do update set key = excluded.key, sort_order = excluded.sort_order, active = true`
    : tx`do nothing`;
  const categories = await tx`
    insert into trait_categories (key, label, sort_order)
    -- Position among the trait categories, so the dataset-column rows the v1
    -- file lists first do not push every category down.
    select trim(broad_category),
           initcap(replace(trim(broad_category), '_', ' ')),
           (row_number() over (order by min(row_no)))::int
    from dictionary_staging
    where trim(broad_category) <> ''
      and lower(trim(broad_category)) not in ('taxonomy', 'reference', 'record')
    group by trim(broad_category)
    on conflict (key) ${onCategory}`;
  const traits = await tx`
    insert into traits (key, category_key, value_type, unit, description, active)
    select trim(standard_trait), trim(broad_category), trim(value_type),
           nullif(trim(standard_unit), ''), coalesce(description, ''),
           coalesce(case lower(trim(active)) when 'true' then true when 'false' then false end, true)
    from dictionary_staging
    where ${traitRow(tx)}
    order by row_no
    on conflict (key) ${onTrait}`;
  // A level listed twice in different case (R1's `lower(key)` uniqueness) is
  // taken once, at its first position: the `do update` of a sync may not touch
  // a row twice in one statement.
  const levels = await tx`
    insert into trait_levels (trait_id, key, sort_order)
    select trait_id, key, ord from (
      select distinct on (t.id, lower(trim(l.key))) t.id as trait_id, trim(l.key) as key,
             l.ord::int as ord, s.row_no
      from dictionary_staging s
      join traits t on t.key = trim(s.standard_trait)
      cross join lateral unnest(string_to_array(s.harmonised_levels, ';')) with ordinality as l(key, ord)
      where coalesce(s.harmonised_levels, '') <> '' and trim(l.key) <> ''
        and lower(trim(s.broad_category)) not in ('taxonomy', 'reference', 'record')
      order by t.id, lower(trim(l.key)), s.row_no, l.ord) first_spelling
    order by row_no, ord
    on conflict (trait_id, lower(key)) ${onLevel}`;
  return { categories: categories.count, traits: traits.count, levels: levels.count };
}

/**
 * Inserts the categories, traits and levels the database lacks; never updates.
 * A row whose trimmed `broad_category` is `taxonomy`, `reference` or `record`
 * is skipped: these describe columns of the compiled dataset file, not traits.
 * @rfc RFC-62 R2
 */
export async function seedDictionary(
  db: Db,
  csvPath = dictionaryPath(),
  options: SeedOptions = {},
): Promise<SeedReport> {
  return db.$client.begin(async (tx): Promise<SeedReport> => {
    await stageDictionary(tx, csvPath, options);
    return upsertDictionary(tx, false);
  });
}

/** The dictionary's size after a sync. @rfc RFC-62 R9 */
export interface SyncReport {
  traits: number;
  levels: number;
}

/**
 * Makes the dictionary equal to the file, inside the caller's transaction:
 * inserts or rewrites what the file lists, then deletes every level, trait
 * and category it does not name. Only a total replace may call it, right
 * after its wipe, when nothing references a trait or a level any more.
 * @rfc RFC-62 R9
 */
export async function syncDictionary(
  tx: TransactionSql | Sql,
  csvPath = dictionaryPath(),
  options: SeedOptions = {},
): Promise<SyncReport> {
  await stageDictionary(tx, csvPath, options);
  await upsertDictionary(tx, true);
  await tx`
    delete from trait_levels l
    using traits t
    where t.id = l.trait_id
      and not exists (
        select 1 from dictionary_staging s
        cross join lateral unnest(string_to_array(s.harmonised_levels, ';')) as x(key)
        where trim(s.standard_trait) = t.key and ${traitRow(tx)}
          and lower(trim(x.key)) = lower(l.key))`;
  await tx`
    delete from traits t
    where not exists (
      select 1 from dictionary_staging s
      where trim(s.standard_trait) = t.key and ${traitRow(tx)})`;
  await tx`
    delete from trait_categories c
    where not exists (select 1 from traits t where t.category_key = c.key)`;
  await tx`drop table dictionary_staging`;
  const [size] = (await tx`
    select (select count(*) from traits)::int as traits,
           (select count(*) from trait_levels)::int as levels`) as SyncReport[];
  return size as SyncReport;
}
