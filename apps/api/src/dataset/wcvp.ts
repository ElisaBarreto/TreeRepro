import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import type postgres from 'postgres';
import type { Db } from '../db/client.ts';
import { DEFAULT_COPY_IDLE_TIMEOUT_MS, pipelineWithIdleGuard } from '../db/copy.ts';
import { ImportRefusedError, readFirstLine } from './import.ts';

/** Columns `import:wcvp` needs from `wcvp_names.csv`. @rfc RFC-78 R2 */
export const WCVP_NAMES_COLUMNS = [
  'plant_name_id',
  'taxon_rank',
  'taxon_status',
  'taxon_name',
  'lifeform_description',
] as const;

/** Columns `import:wcvp` needs from `wcvp_distribution.csv`. @rfc RFC-78 R2 */
export const WCVP_DISTRIBUTION_COLUMNS = [
  'plant_name_id',
  'continent_code_l1',
  'continent',
  'region_code_l2',
  'region',
  'area_code_l3',
  'area',
  'introduced',
  'extinct',
  'location_doubtful',
] as const;

/** What a load kept. @rfc RFC-78 R2 */
export interface WcvpCounts {
  acceptedSpecies: number;
  treeSpecies: number;
  regions: number;
  distributionRows: number;
}

/** Header columns, refusing a file without every needed one. */
async function readHeader(path: string, needed: readonly string[]): Promise<string[]> {
  const header = (await readFirstLine(path))
    .replace(/^﻿/, '')
    .replace(/\r$/, '')
    .split('|')
    .map((c) => c.trim());
  const missing = needed.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new ImportRefusedError(
      'header_mismatch',
      `${basename(path)} is missing the column(s) ${missing.join(', ')}`,
    );
  }
  return header;
}

/**
 * Streams a Kew file into a temporary table with one text column `cN` per
 * header column, so no file-supplied name becomes an identifier; `row_no` is
 * the file order. Kew does not quote fields but uses bare `"`, so the quote is
 * set to \x01, a byte absent from the files.
 * Answers the staging column of each needed name.
 */
async function stage(
  tx: postgres.TransactionSql,
  table: string,
  path: string,
  header: string[],
  needed: readonly string[],
  idleTimeoutMs: number,
): Promise<Record<string, string>> {
  const cols = header.map((_, i) => `c${i}`);
  await tx.unsafe(
    `create temporary table ${table} (row_no bigserial primary key, ${cols
      .map((c) => `${c} text`)
      .join(', ')}) on commit drop`,
  );
  const writable = await tx
    .unsafe(
      `copy ${table} (${cols.join(', ')}) from stdin with (format csv, delimiter '|', header true, quote E'\\x01', encoding 'UTF8')`,
    )
    .writable();
  await pipelineWithIdleGuard(createReadStream(path), writable, idleTimeoutMs);
  return Object.fromEntries(needed.map((name) => [name, `c${header.indexOf(name)}`]));
}

/**
 * `import:wcvp`: replaces the WCVP tables with the accepted species, regions
 * (with their level-2 region and level-1 continent) and extant distribution,
 * native or introduced, of Kew's two files, in one transaction.
 * @rfc RFC-78 R2-R5
 */
export async function importWcvp(
  db: Db,
  input: { namesPath: string; distributionPath: string; copyIdleTimeoutMs?: number },
): Promise<WcvpCounts> {
  const namesHeader = await readHeader(input.namesPath, WCVP_NAMES_COLUMNS);
  const distHeader = await readHeader(input.distributionPath, WCVP_DISTRIBUTION_COLUMNS);
  const idle = input.copyIdleTimeoutMs ?? DEFAULT_COPY_IDLE_TIMEOUT_MS;
  return db.$client.begin(async (tx) => {
    const n = await stage(
      tx,
      'wcvp_names_staging',
      input.namesPath,
      namesHeader,
      WCVP_NAMES_COLUMNS,
      idle,
    );
    const d = await stage(
      tx,
      'wcvp_distribution_staging',
      input.distributionPath,
      distHeader,
      WCVP_DISTRIBUTION_COLUMNS,
      idle,
    );
    const code = `upper(trim(${d.area_code_l3}))`;
    await tx`truncate wcvp_distribution, wcvp_species, wcvp_regions`;
    await tx.unsafe(`
      insert into wcvp_species (plant_name_id, taxon_name, is_tree, file_order)
      select trim(${n.plant_name_id}), trim(regexp_replace(${n.taxon_name}, '\\s+', ' ', 'g')),
        coalesce(${n.lifeform_description} ~* '\\mtree\\M|arborescent|phanerophyte', false), row_no
      from wcvp_names_staging
      where ${n.taxon_status} = 'Accepted' and ${n.taxon_rank} = 'Species'
        and trim(${n.plant_name_id}) <> '' and trim(${n.taxon_name}) <> ''`);
    // R5: each column is the first non-blank value given for the code in file order.
    const first = (column: string | undefined) =>
      `(array_agg(nullif(trim(${column}), '') order by row_no)
          filter (where nullif(trim(${column}), '') is not null))[1]`;
    await tx.unsafe(`
      insert into wcvp_regions (area_code_l3, name, region_code_l2, region, continent_code_l1, continent)
      select code, coalesce(name, code), region_code, coalesce(region, region_code),
        continent_code, coalesce(continent, continent_code)
      from (
        select ${code} as code, ${first(d.area)} as name,
          ${first(d.region_code_l2)} as region_code, ${first(d.region)} as region,
          ${first(d.continent_code_l1)} as continent_code, ${first(d.continent)} as continent
        from wcvp_distribution_staging
        where trim(${d.area_code_l3}) <> ''
        group by ${code}) g`);
    // R4: a pair is introduced only when every kept row of it is.
    await tx.unsafe(`
      insert into wcvp_distribution (plant_name_id, area_code_l3, introduced)
      select w.plant_name_id, ${code}, bool_and(coalesce(trim(${d.introduced}), '') = '1')
      from wcvp_distribution_staging
      join wcvp_species w on w.plant_name_id = trim(${d.plant_name_id})
      where trim(${d.area_code_l3}) <> ''
        and coalesce(trim(${d.extinct}), '') <> '1'
        and coalesce(trim(${d.location_doubtful}), '') <> '1'
      group by w.plant_name_id, ${code}`);
    const [counts] = (await tx`
      select
        (select count(*)::int from wcvp_species) as "acceptedSpecies",
        (select count(*)::int from wcvp_species where is_tree) as "treeSpecies",
        (select count(*)::int from wcvp_regions) as "regions",
        (select count(*)::int from wcvp_distribution) as "distributionRows"`) as [WcvpCounts];
    return counts;
  }) as Promise<WcvpCounts>;
}
