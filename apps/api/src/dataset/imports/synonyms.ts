import type { ImportBatch } from '@treerepro/contracts';
import type { Db } from '../../db/client.ts';
import { runSupplementaryImport, type SupplementaryApplyResult } from './framework.ts';

/** @rfc RFC-68 R12 */
export const SYNONYMS_HEADER = [
  'wcvp_canonical_name',
  'synonym_or_common_name',
  'name_type',
  'source',
] as const;

/**
 * Kind `synonyms`: alternative names for existing species — synonyms and
 * common names — matched by their canonical name (RFC-60 R2, exact after
 * whitespace normalisation, case preserved). `name_type` is `synonym` or
 * `common_<lang>` (two lowercase letters); anything else is `invalid_value`.
 * A name equal to the species' canonical name, or already stored for it
 * (whatever its type), is a duplicate; an empty `source` becomes `'import'`.
 * @rfc RFC-68 R12
 */
export async function importSynonyms(
  db: Db,
  input: { filePath: string; runBy: string | null; copyIdleTimeoutMs?: number },
): Promise<ImportBatch> {
  return runSupplementaryImport(db, {
    kind: 'synonyms',
    header: SYNONYMS_HEADER,
    filePath: input.filePath,
    runBy: input.runBy,
    copyIdleTimeoutMs: input.copyIdleTimeoutMs,
    async apply(tx, batchId): Promise<SupplementaryApplyResult> {
      await tx`
        alter table import_staging
          add column parsed_canonical text,
          add column parsed_name text,
          add column parsed_type text,
          add column parsed_lang char(2),
          add column parsed_source text,
          add column species_id_fk uuid,
          add column species_canonical text,
          add column outcome text`;
      await tx`
        update import_staging set
          parsed_canonical = nullif(trim(regexp_replace(coalesce(wcvp_canonical_name, ''), '\\s+', ' ', 'g')), ''),
          parsed_name = nullif(trim(regexp_replace(coalesce(synonym_or_common_name, ''), '\\s+', ' ', 'g')), ''),
          parsed_source = coalesce(nullif(trim(coalesce(source, '')), ''), 'import')`;
      await tx`
        update import_staging set
          parsed_type = case
            when trim(coalesce(name_type, '')) = 'synonym' then 'synonym'
            when trim(coalesce(name_type, '')) ~ '^common_[a-z]{2}$' then 'common'
            else null
          end,
          parsed_lang = case
            when trim(coalesce(name_type, '')) ~ '^common_[a-z]{2}$'
              then (regexp_match(trim(name_type), '^common_([a-z]{2})$'))[1]
            else null
          end`;
      await tx`
        update import_staging s set species_id_fk = sp.id, species_canonical = sp.canonical_name
        from species sp where sp.canonical_name = s.parsed_canonical`;
      await tx`
        update import_staging set outcome = case
          when parsed_canonical is null or parsed_name is null or parsed_type is null then 'invalid_value'
          when species_id_fk is null then 'unknown_species'
          else 'apply' end`;
      await tx`
        insert into import_rejects (batch_id, row_no, reason, raw_row)
        select ${batchId}, row_no, outcome,
          jsonb_build_object(
            'wcvp_canonical_name', coalesce(wcvp_canonical_name, ''),
            'synonym_or_common_name', coalesce(synonym_or_common_name, ''),
            'name_type', coalesce(name_type, ''),
            'source', coalesce(source, '')
          )
        from import_staging where outcome <> 'apply' order by row_no`;
      const [{ apply_count: applyCount }] = (await tx`
        select count(*)::int as apply_count from import_staging where outcome = 'apply'`) as [
        { apply_count: number },
      ];
      // `species_canonical` is the exact stored canonical name (case
      // preserved, RFC-60 R2); a row whose parsed name equals it is excluded
      // here — the business rule of RFC-60 R4, which the unique index cannot
      // enforce on its own. `on conflict do nothing` then absorbs a name
      // already stored for the species, including two identical rows inside
      // the SAME file: Postgres checks the unique index against rows already
      // inserted earlier in this same statement, so the second identical row
      // is silently skipped too. `duplicate` is derived by subtraction
      // (RFC-68 R4), not counted directly, so a row excluded here or by the
      // conflict is counted as duplicate exactly once, never also rejected.
      const applied = await tx`
        insert into species_names (species_id, name, name_type, language, source)
        select species_id_fk, parsed_name, parsed_type, parsed_lang, parsed_source
        from import_staging
        where outcome = 'apply' and parsed_name <> species_canonical
        order by row_no
        on conflict (species_id, name) do nothing`;
      const [{ rejected }] =
        (await tx`select count(*)::int as rejected from import_staging where outcome <> 'apply'`) as [
          { rejected: number },
        ];
      return { inserted: applied.count, duplicate: applyCount - applied.count, rejected };
    },
  });
}
