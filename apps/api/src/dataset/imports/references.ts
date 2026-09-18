import type { ImportBatch } from '@treerepro/contracts';
import type { Db } from '../../db/client.ts';
import { normaliseDoi } from '../../integrations/doi.ts';
import { runSupplementaryImport, type SupplementaryApplyResult } from './framework.ts';

/** @rfc RFC-68 R13 */
export const REFERENCES_HEADER = [
  'reference_key',
  'short_citation',
  'full_citation',
  'doi',
  'url',
] as const;

/**
 * Fills `short_citation`, `full_citation`, `doi` and `url` on an existing
 * reference, matched by `citation_key` — but only where the stored value is
 * currently null; a filled field is never overwritten. `doi` is normalised
 * (RFC-80 R1) and compared case-insensitively against the `lower(doi)`
 * unique index (`bibliographic_references_doi_idx`,
 * `apps/api/drizzle/0021_contribution.sql`) before it is accepted: a DOI
 * already held by a different reference rejects the whole row as
 * `doi_taken`, a malformed one as `invalid_value`, whether or not the row
 * would otherwise have used it. When a key repeats in the same file, only
 * the last row is a candidate to apply (RFC-68 R4); earlier rows for that
 * key count as duplicate whatever they contain.
 * @rfc RFC-68 R13
 */
export async function importReferences(
  db: Db,
  input: { filePath: string; runBy: string | null; copyIdleTimeoutMs?: number },
): Promise<ImportBatch> {
  return runSupplementaryImport(db, {
    kind: 'references',
    header: REFERENCES_HEADER,
    filePath: input.filePath,
    runBy: input.runBy,
    copyIdleTimeoutMs: input.copyIdleTimeoutMs,
    async apply(tx, batchId): Promise<SupplementaryApplyResult> {
      await tx`
        alter table import_staging
          add column ref_key text,
          add column s_short text,
          add column s_full text,
          add column s_doi_raw text,
          add column s_url text,
          add column norm_doi text,
          add column doi_malformed boolean not null default false,
          add column reference_id uuid,
          add column is_winner boolean not null default false,
          add column outcome text`;

      await tx`
        update import_staging set
          ref_key = nullif(trim(reference_key), ''),
          s_short = nullif(trim(short_citation), ''),
          s_full = nullif(trim(full_citation), ''),
          s_doi_raw = nullif(trim(doi), ''),
          s_url = nullif(trim(url), '')`;

      // DOI normalisation (RFC-80 R1) reuses `normaliseDoi` so imported DOIs
      // pass through the exact same rule as every other DOI entry point;
      // batched per distinct raw value, the same shape `importUserPlots`
      // uses for e-mail hashes.
      const rawDois = (await tx`
        select distinct s_doi_raw as raw from import_staging where s_doi_raw is not null`) as {
        raw: string;
      }[];
      const validPairs: [string, string][] = [];
      const malformedRaws: string[] = [];
      for (const { raw } of rawDois) {
        const norm = normaliseDoi(raw);
        if (norm) validPairs.push([raw, norm]);
        else malformedRaws.push(raw);
      }
      for (let i = 0; i < validPairs.length; i += 1000) {
        const chunk = validPairs.slice(i, i + 1000);
        await tx`
          update import_staging s
          set norm_doi = v.norm
          from (values ${tx(chunk)}) as v(raw, norm)
          where s.s_doi_raw = v.raw`;
      }
      if (malformedRaws.length > 0) {
        await tx`
          update import_staging set doi_malformed = true where s_doi_raw = any(${malformedRaws})`;
      }

      await tx`
        update import_staging s set reference_id = r.id
        from bibliographic_references r where r.citation_key = s.ref_key`;

      // RFC-68 R4: a repeated key — only the last row (highest row_no) for
      // a given staged key is a candidate to apply; every earlier row for
      // that key is duplicate whatever it contains. This runs BEFORE any
      // outcome validation below, and is grouped by the staged `ref_key`,
      // not `reference_id`: an unknown key has no `reference_id`, and
      // grouping by that null would lump every unmatched row in the whole
      // file into one group, hiding the real per-key repetition. Grouping
      // by `ref_key` keeps `unknown_reference` scoped to a row whose own
      // key matches nothing, while a *repeated* unknown key still picks one
      // winner the same as a matched key does.
      await tx`
        update import_staging s set is_winner = true
        where s.row_no in (select max(row_no) from import_staging group by ref_key)`;

      // Priority: a non-winning row of a repeated key is duplicate whatever
      // it contains (RFC-68 R4, checked first so validation below never
      // runs on it); then unknown target; then malformed input; then a DOI
      // already held elsewhere — checked case-insensitively against
      // lower(doi), agreeing with bibliographic_references_doi_idx, and
      // excluding the row's own reference (which may already hold that
      // exact DOI, case-varied — not a conflict).
      //
      // Deliberate asymmetry, for a key's winning row: `short_citation`,
      // `full_citation` and `url` are never validated (any non-empty text
      // fills them), but `doi` is checked for malformed-ness and cross-row
      // collision unconditionally — even when the target reference already
      // has a stored doi and this field would never be written. That's
      // intentional: unlike the other three fields, `doi_taken` is a
      // cross-row uniqueness signal ("this row claims a DOI belonging to a
      // *different* reference"), a genuine data conflict in the operator's
      // source file that is worth surfacing on its own merits, whether or
      // not the row would have used the value. Folding it into a bland
      // "duplicate" would hide that conflict from the report. (RFC-68 R13
      // doesn't spell this out; recorded here so a future reader doesn't
      // "fix" it back to matching the other fields.)
      await tx`
        update import_staging s set outcome = case
          when not s.is_winner then 'duplicate'
          when reference_id is null then 'unknown_reference'
          when doi_malformed then 'invalid_value'
          when norm_doi is not null and exists (
            select 1 from bibliographic_references r2
            where lower(r2.doi) = s.norm_doi and r2.id <> s.reference_id
          ) then 'doi_taken'
          else 'apply' end`;

      // Guard against two winning rows in the same file trying to give the
      // same brand-new DOI to two different references — postgres would
      // raise 23505 mid-statement on the update below (an aborted
      // transaction we must not catch-and-re-read, docs/gotchas/drizzle.md);
      // catch it here instead, keeping only the earliest such row and
      // rejecting the rest as doi_taken. `s.is_winner` is already implied
      // by `s.outcome = 'apply'` at this point (duplicates were excluded
      // above); kept explicit for clarity.
      await tx`
        update import_staging s set outcome = 'doi_taken', is_winner = false
        where s.outcome = 'apply' and s.is_winner and s.norm_doi is not null
          and exists (select 1 from bibliographic_references r where r.id = s.reference_id and r.doi is null)
          and s.row_no > (
            select min(s2.row_no) from import_staging s2
            where s2.outcome = 'apply' and s2.is_winner and s2.norm_doi = s.norm_doi
              and exists (
                select 1 from bibliographic_references r2 where r2.id = s2.reference_id and r2.doi is null
              )
          )`;

      await tx`
        insert into import_rejects (batch_id, row_no, reason, raw_row)
        select ${batchId}, row_no, outcome, jsonb_build_object(
          'reference_key', coalesce(reference_key, ''),
          'short_citation', coalesce(short_citation, ''),
          'full_citation', coalesce(full_citation, ''),
          'doi', coalesce(doi, ''),
          'url', coalesce(url, '')
        )
        from import_staging where outcome in ('unknown_reference', 'invalid_value', 'doi_taken')
        order by row_no`;

      // `duplicate` counts two distinct things, added together: a row that
      // never got to apply at all because a later row of its key won
      // instead (`outcome = 'duplicate'`, RFC-68 R4), and a winning row
      // whose `outcome = 'apply'` but that changed nothing on the stored
      // reference (every field it carries was already filled — `applied`
      // below only counts a row once something actually changed). Either
      // way `rows_total = inserted + duplicate + rejected` still holds.
      const [{ candidate_count: candidateCount, dup_outcome_count: dupOutcomeCount }] = (await tx`
        select
          count(*) filter (where outcome = 'apply')::int as candidate_count,
          count(*) filter (where outcome = 'duplicate')::int as dup_outcome_count
        from import_staging`) as [{ candidate_count: number; dup_outcome_count: number }];

      // Fill only the fields still null on the stored row (never overwrite);
      // the WHERE re-checks that at least one field actually changes, so the
      // update only touches, and this statement only counts, rows that fill
      // something — a row that fills nothing never reaches `inserted`.
      const applied = await tx`
        update bibliographic_references r set
          short_citation = coalesce(r.short_citation, s.s_short),
          full_citation = coalesce(r.full_citation, s.s_full),
          doi = coalesce(r.doi, s.norm_doi),
          url = coalesce(r.url, s.s_url)
        from import_staging s
        where r.id = s.reference_id and s.outcome = 'apply' and s.is_winner
          and (
            r.short_citation is distinct from coalesce(r.short_citation, s.s_short)
            or r.full_citation is distinct from coalesce(r.full_citation, s.s_full)
            or r.doi is distinct from coalesce(r.doi, s.norm_doi)
            or r.url is distinct from coalesce(r.url, s.s_url)
          )`;

      const [{ rejected }] = (await tx`
        select count(*)::int as rejected from import_staging
        where outcome in ('unknown_reference', 'invalid_value', 'doi_taken')`) as [
        { rejected: number },
      ];

      return {
        inserted: applied.count,
        duplicate: candidateCount - applied.count + dupOutcomeCount,
        rejected,
      };
    },
  });
}
