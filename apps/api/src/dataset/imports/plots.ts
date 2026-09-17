import type { ImportBatch } from '@treerepro/contracts';
import type { Db } from '../../db/client.ts';
import { getPii } from '../../security/pii.ts';
import { runSupplementaryImport, type SupplementaryApplyResult } from './framework.ts';

/** @rfc RFC-68 R9 */
export const PLOTS_HEADER = [
  'plot_id',
  'name',
  'description',
  'latitude',
  'longitude',
  'country',
  'biome',
] as const;

/** @rfc RFC-68 R10 */
export const PLOT_SPECIES_HEADER = ['plot_id', 'wcvp_species'] as const;

/** @rfc RFC-68 R11 */
export const USER_PLOTS_HEADER = ['user_email', 'plot_id'] as const;

/** @rfc RFC-68 R9 */
export async function importPlots(
  db: Db,
  input: { filePath: string; runBy: string | null; copyIdleTimeoutMs?: number },
): Promise<ImportBatch> {
  return runSupplementaryImport(db, {
    kind: 'plots',
    header: PLOTS_HEADER,
    filePath: input.filePath,
    runBy: input.runBy,
    copyIdleTimeoutMs: input.copyIdleTimeoutMs,
    async apply(tx, batchId): Promise<SupplementaryApplyResult> {
      await tx`
        alter table import_staging
          add column parsed_code text,
          add column parsed_name text,
          add column parsed_description text,
          add column lat double precision,
          add column lon double precision,
          add column parsed_country text,
          add column parsed_biome text,
          add column outcome text`;
      await tx`
        update import_staging set
          parsed_code = nullif(trim(plot_id), ''),
          parsed_name = nullif(trim(name), ''),
          parsed_description = coalesce(nullif(trim(description), ''), ''),
          lat = case when trim(coalesce(latitude, '')) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' then trim(latitude)::double precision end,
          lon = case when trim(coalesce(longitude, '')) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' then trim(longitude)::double precision end,
          parsed_country = nullif(trim(country), ''),
          parsed_biome = nullif(trim(biome), '')`;
      await tx`
        update import_staging set outcome = case
          when parsed_code is null or parsed_name is null then 'invalid_value'
          when nullif(trim(coalesce(latitude, '')), '') is not null and (lat is null or lat < -90 or lat > 90) then 'invalid_value'
          when nullif(trim(coalesce(longitude, '')), '') is not null and (lon is null or lon < -180 or lon > 180) then 'invalid_value'
          else 'apply' end`;
      await tx`
        insert into import_rejects (batch_id, row_no, reason, raw_row)
        select ${batchId}, row_no, outcome,
          jsonb_build_object(
            'plot_id', coalesce(plot_id, ''),
            'name', coalesce(name, ''),
            'description', coalesce(description, ''),
            'latitude', coalesce(latitude, ''),
            'longitude', coalesce(longitude, ''),
            'country', coalesce(country, ''),
            'biome', coalesce(biome, '')
          )
        from import_staging where outcome <> 'apply' order by row_no`;
      const [{ apply_count: applyCount }] = (await tx`
        select count(*)::int as apply_count from import_staging where outcome = 'apply'`) as [
        { apply_count: number },
      ];
      const applied = await tx`
        insert into plots (code, name, description, latitude, longitude, country, biome, created_by)
        select distinct on (lower(parsed_code))
          parsed_code, parsed_name, parsed_description, lat, lon, parsed_country, parsed_biome, ${input.runBy}
        from import_staging
        where outcome = 'apply' and not exists (
          select 1 from plots p where lower(p.code) = lower(import_staging.parsed_code)
        )
        order by lower(parsed_code), row_no desc`;
      const [{ rejected }] =
        (await tx`select count(*)::int as rejected from import_staging where outcome <> 'apply'`) as [
          { rejected: number },
        ];
      return { inserted: applied.count, duplicate: applyCount - applied.count, rejected };
    },
  });
}

/** @rfc RFC-68 R10 */
export async function importPlotSpecies(
  db: Db,
  input: { filePath: string; runBy: string | null; copyIdleTimeoutMs?: number },
): Promise<ImportBatch> {
  return runSupplementaryImport(db, {
    kind: 'plot_species',
    header: PLOT_SPECIES_HEADER,
    filePath: input.filePath,
    runBy: input.runBy,
    copyIdleTimeoutMs: input.copyIdleTimeoutMs,
    async apply(tx, batchId): Promise<SupplementaryApplyResult> {
      await tx`
        alter table import_staging
          add column species_name text,
          add column plot_id_fk uuid,
          add column species_id_fk uuid,
          add column outcome text`;
      await tx`
        update import_staging set
          species_name = nullif(trim(regexp_replace(coalesce(wcvp_species, ''), '\\s+', ' ', 'g')), '')`;
      await tx`
        update import_staging s set plot_id_fk = p.id
        from plots p where lower(p.code) = lower(trim(s.plot_id))`;
      await tx`
        update import_staging s set species_id_fk = sp.id
        from species sp where sp.canonical_name = s.species_name`;
      await tx`
        update import_staging set outcome = case
          when plot_id_fk is null then 'unknown_plot'
          when species_id_fk is null then 'unknown_species'
          else 'apply' end`;
      await tx`
        insert into import_rejects (batch_id, row_no, reason, raw_row)
        select ${batchId}, row_no, outcome,
          jsonb_build_object('plot_id', coalesce(plot_id, ''), 'wcvp_species', coalesce(wcvp_species, ''))
        from import_staging where outcome <> 'apply' order by row_no`;
      const [{ apply_count: applyCount }] = (await tx`
        select count(*)::int as apply_count from import_staging where outcome = 'apply'`) as [
        { apply_count: number },
      ];
      const applied = await tx`
        insert into plot_species (plot_id, species_id)
        select distinct plot_id_fk, species_id_fk
        from import_staging
        where outcome = 'apply'
        on conflict (plot_id, species_id) do nothing`;
      const [{ rejected }] =
        (await tx`select count(*)::int as rejected from import_staging where outcome <> 'apply'`) as [
          { rejected: number },
        ];
      return { inserted: applied.count, duplicate: applyCount - applied.count, rejected };
    },
  });
}

/** @rfc RFC-68 R11 */
export async function importUserPlots(
  db: Db,
  input: { filePath: string; runBy: string | null; copyIdleTimeoutMs?: number },
): Promise<ImportBatch> {
  return runSupplementaryImport(db, {
    kind: 'user_plots',
    header: USER_PLOTS_HEADER,
    filePath: input.filePath,
    runBy: input.runBy,
    copyIdleTimeoutMs: input.copyIdleTimeoutMs,
    async apply(tx, batchId): Promise<SupplementaryApplyResult> {
      await tx`
        alter table import_staging
          add column email_hash text,
          add column user_id uuid,
          add column plot_id_fk uuid,
          add column outcome text`;

      const emails = (await tx`
        select distinct nullif(trim(user_email), '') as email
        from import_staging
        where nullif(trim(user_email), '') is not null`) as [{ email: string }];

      if (emails.length > 0) {
        const pii = getPii();
        const pairs = emails.map((e) => [e.email, pii.blindIndex(e.email)]);
        for (let i = 0; i < pairs.length; i += 1000) {
          const chunk = pairs.slice(i, i + 1000);
          await tx`
            update import_staging s
            set email_hash = v.hash
            from (values ${tx(chunk)}) as v(email, hash)
            where nullif(trim(s.user_email), '') = v.email`;
        }
      }

      await tx`
        update import_staging s set user_id = u.id
        from users u where u.email_hash = s.email_hash`;
      await tx`
        update import_staging s set plot_id_fk = p.id
        from plots p where lower(p.code) = lower(trim(s.plot_id))`;
      await tx`
        update import_staging set outcome = case
          when user_id is null then 'unknown_user'
          when plot_id_fk is null then 'unknown_plot'
          else 'apply' end`;
      await tx`
        insert into import_rejects (batch_id, row_no, reason, raw_row)
        select ${batchId}, row_no, outcome,
          jsonb_build_object('user_email', coalesce(user_email, ''), 'plot_id', coalesce(plot_id, ''))
        from import_staging where outcome <> 'apply' order by row_no`;
      const [{ apply_count: applyCount }] = (await tx`
        select count(*)::int as apply_count from import_staging where outcome = 'apply'`) as [
        { apply_count: number },
      ];
      const applied = await tx`
        insert into user_plots (user_id, plot_id)
        select distinct user_id, plot_id_fk
        from import_staging
        where outcome = 'apply'
        on conflict (user_id, plot_id) do nothing`;
      const [{ rejected }] =
        (await tx`select count(*)::int as rejected from import_staging where outcome <> 'apply'`) as [
          { rejected: number },
        ];
      return { inserted: applied.count, duplicate: applyCount - applied.count, rejected };
    },
  });
}
