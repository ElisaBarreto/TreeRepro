import type { ImportBatch } from '@treerepro/contracts';
import type { Db } from '../../db/client.ts';
import { runSupplementaryImport, type SupplementaryApplyResult } from './framework.ts';

/** @rfc RFC-68 R8 */
export const SPECIES_STATUS_HEADER = ['wcvp_species', 'active'] as const;

/** @rfc RFC-68 R8 */
export async function importSpeciesStatus(
  db: Db,
  input: { filePath: string; runBy: string | null; copyIdleTimeoutMs?: number },
): Promise<ImportBatch> {
  return runSupplementaryImport(db, {
    kind: 'species_status',
    header: SPECIES_STATUS_HEADER,
    filePath: input.filePath,
    runBy: input.runBy,
    copyIdleTimeoutMs: input.copyIdleTimeoutMs,
    async apply(tx, batchId): Promise<SupplementaryApplyResult> {
      await tx`
        alter table import_staging
          add column species_name text, add column flag boolean, add column species_id uuid, add column outcome text`;
      await tx`
        update import_staging set
          species_name = nullif(trim(regexp_replace(coalesce(wcvp_species, ''), '\\s+', ' ', 'g')), ''),
          flag = case lower(trim(coalesce(active, ''))) when 'true' then true when 'false' then false else null end`;
      await tx`update import_staging s set species_id = sp.id from species sp where sp.canonical_name = s.species_name`;
      await tx`
        update import_staging set outcome = case
          when flag is null then 'invalid_value'
          when species_id is null then 'unknown_species'
          else 'apply' end`;
      await tx`
        insert into import_rejects (batch_id, row_no, reason, raw_row)
        select ${batchId}, row_no, outcome, jsonb_build_object('wcvp_species', coalesce(wcvp_species, ''), 'active', coalesce(active, ''))
        from import_staging where outcome <> 'apply' order by row_no`;
      // duplicate: apply rows already in the requested state. When a species
      // repeats across rows this counts every matching row, not just the
      // winner (see the update below) — accepted per RFC-68 R8, documented
      // there as a rows_total = inserted + duplicate + rejected edge case.
      const [{ duplicate }] = (await tx`
        select count(*)::int as duplicate from import_staging s join species sp on sp.id = s.species_id
        where s.outcome = 'apply' and sp.active = s.flag`) as [{ duplicate: number }];
      // The last row for a species wins: `distinct on (species_id) ... order
      // by species_id, row_no desc` keeps only the highest row_no per
      // species before writing `species.active`.
      const applied = await tx`
        update species sp set active = s.flag
        from (select distinct on (species_id) species_id, flag from import_staging where outcome = 'apply' order by species_id, row_no desc) s
        where sp.id = s.species_id and sp.active <> s.flag`;
      const [{ rejected }] =
        (await tx`select count(*)::int as rejected from import_staging where outcome <> 'apply'`) as [
          { rejected: number },
        ];
      return { inserted: applied.count, duplicate, rejected };
    },
  });
}
