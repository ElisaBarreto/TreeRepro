import { open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { TransactionSql } from 'postgres';
import { getPii } from '../security/pii.ts';
import { ANNOTATION_COLUMNS, csvRow, REF_LABEL, REFERENCES_OF_R } from './export.ts';
import { APPEND_ONLY_TRIGGERS } from './reset.ts';

/**
 * The annotation sheet: the columns of `annotations.csv` (RFC-66 R2) and
 * what the run did with the row: `pending` before the wipe, then `relinked`
 * or `orphan`.
 * @rfc RFC-64 R15
 */
export const SHEET_COLUMNS = [...ANNOTATION_COLUMNS, 'status'] as const;

/** `<dir>/replace-<batch id>-annotations.csv` (spec R-20). @rfc RFC-64 R15 */
export function sheetPath(dir: string, batchId: string): string {
  return join(dir, `replace-${batchId}-annotations.csv`);
}

// RFC-63 R4 grants R15 an exception on these two tables only: the contest
// tables keep their guard, so a stray write there fails the run.
const R15_TRIGGERS = APPEND_ONLY_TRIGGERS.filter(
  ([table]) => table === 'trait_records' || table === 'record_annotations',
);

// 13i's reference label and reference list, rendered once to SQL text for the
// two stash statements below. Neither fragment binds a parameter, so the text
// is the whole fragment; the check keeps it that way.
const dialect = new PgDialect();
function rendered(fragment: SQL): string {
  const query = dialect.sqlToQuery(fragment);
  if (query.params.length > 0) {
    throw new Error('replace-imported: a shared fragment gained a parameter');
  }
  return query.sql;
}
const REF_LABEL_SQL = rendered(REF_LABEL);
// REFERENCES_OF_R reads the record aliased `r`, so the stash below names the
// responding TR_ record `r`.
const REFERENCES_OF_R_SQL = rendered(REFERENCES_OF_R);

/** One sheet row and the key that pairs it with its outcome. @rfc RFC-64 R15 */
export interface SheetRow {
  /** `a:<annotation id>` or `l:<link>:<record id>`. */
  key: string;
  fields: [string, string, string, string, string | null, string | null];
}

/** What {@link detachImported} stashed, for {@link relinkImported}. @rfc RFC-64 R15 */
export interface DetachedImported {
  path: string;
  rows: SheetRow[];
}

async function writeSheet(
  path: string,
  rows: SheetRow[],
  status: (row: SheetRow) => string,
): Promise<void> {
  // 0600: the sheet names users (RFC-40); `wx`, so neither copy ever
  // overwrites a file already there; fsync, because the pending copy is the
  // record of what the run detached if everything after it fails.
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(
      `\uFEFF${csvRow(SHEET_COLUMNS)}${rows.map((r) => csvRow([...r.fields, status(r)])).join('')}`,
      'utf8',
    );
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * RFC-64 R15 steps 1–2, inside the import's transaction and before the new
 * file is staged:
 * - Turn off the `trait_records` and `record_annotations` append-only
 *   triggers (RFC-63 R4). The ALTERs also lock both tables against writers
 *   until COMMIT, so the stash misses nothing.
 * - Stash every annotation of an `EB_` record and every `TR_` link to one.
 * - Write the sheet, every row `pending`.
 * - Detach the links.
 * - Delete the `EB_` records and their annotations. Nothing else is touched.
 * @rfc RFC-64 R15
 * @rfc RFC-63 R4
 */
export async function detachImported(
  tx: TransactionSql,
  batchId: string,
  sheetDir: string,
): Promise<DetachedImported> {
  for (const [table, trigger] of R15_TRIGGERS) {
    await tx`alter table ${tx(table)} disable trigger ${tx(trigger)}`;
  }
  // `unsafe` only because the two rendered fragments are SQL text; no value
  // is spliced into either statement.
  await tx.unsafe(`
    create temporary table replace_annotations on commit drop as
    select a.id, r.record_code, a.actor_id, a.kind, a.note, a.reference_id, a.generated,
      a.created_at, u.name as user_name, ${REF_LABEL_SQL} as reference
    from record_annotations a
    join trait_records r on r.id = a.record_id
    join users u on u.id = a.actor_id
    left join bibliographic_references b on b.id = a.reference_id
    where r.origin = 'import'`);
  await tx.unsafe(`
    create temporary table replace_links on commit drop as
    select r.id, r.record_code as own_code, tgt.record_code as target_code,
      'responds_to'::text as link, r.intent::text as kind, r.intent, r.created_at,
      u.name as user_name, ${REFERENCES_OF_R_SQL} as reference
    from trait_records r
    join trait_records tgt on tgt.id = r.responds_to_record_id
    join users u on u.id = r.created_by
    where tgt.origin = 'import'
    union all
    select r.id, r.record_code, tgt.record_code, 'supersedes', 'harmonisation', null,
      r.created_at, u.name, ${REFERENCES_OF_R_SQL}
    from trait_records r
    join trait_records tgt on tgt.id = r.supersedes_record_id
    join users u on u.id = r.created_by
    where tgt.origin = 'import'`);

  const rows = await tx<
    {
      key: string;
      record_code: string;
      kind: string;
      user_name: string;
      created_at: Date;
      reference: string | null;
      contest_record_code: string | null;
    }[]
  >`
    select 'a:' || id as key, record_code,
      case kind when 'confirm' then 'validation' else kind end as kind,
      user_name, created_at, reference, null::text as contest_record_code, id
    from replace_annotations
    union all
    select 'l:' || link || ':' || id, target_code, kind, user_name, created_at, reference, own_code, id
    from replace_links
    order by 2, 5, 8`;
  const pii = getPii();
  const sheetRows: SheetRow[] = rows.map((r) => ({
    key: r.key,
    fields: [
      r.record_code,
      r.kind,
      pii.decrypt(r.user_name, 'users.name'),
      new Date(r.created_at).toISOString(),
      r.reference,
      r.contest_record_code,
    ],
  }));
  const path = sheetPath(sheetDir, batchId);
  await writeSheet(path, sheetRows, () => 'pending');

  await tx`
    update trait_records k set intent = null, responds_to_record_id = null
    from replace_links l where l.id = k.id and l.link = 'responds_to'`;
  // A harmonisation without a primary reference of its own needs a non-null
  // supersedes_record_id (trait_records_origin_check), so every detached one
  // points at itself until relinkImported settles it.
  await tx`
    update trait_records k set supersedes_record_id = k.id
    from replace_links l where l.id = k.id and l.link = 'supersedes'`;
  await tx`
    delete from record_annotations a using trait_records r
    where r.id = a.record_id and r.origin = 'import'`;
  await tx`delete from trait_records where origin = 'import'`;
  return { path, rows: sheetRows };
}

/**
 * The counters of RFC-69 R2 and RFC-61 R4, R9, rebuilt from the records that
 * are not withdrawn (RFC-63 R13): the mirror of 0038's
 * `trait_records_uncount`, with 13f's `record_references` counted on its own.
 * The deletes of detachImported decremented nothing, so an incremental fix
 * would be wrong. `first_record_at` / `last_record_at` are taken over live
 * records, which can differ from the incremental triggers that never rewind them.
 */
async function recomputeCounters(tx: TransactionSql): Promise<void> {
  await tx`
    update bibliographic_references set primary_count = 0, secondary_count = 0
    where primary_count <> 0 or secondary_count <> 0`;
  await tx`
    update bibliographic_references b set primary_count = u.n
    from (select id, count(*)::int as n from (
            select r.primary_reference_id as id from trait_records r
            where r.primary_reference_id is not null
              and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
            union all
            select rr.reference_id from record_references rr join trait_records r on r.id = rr.record_id
            where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
          ) x group by 1) u
    where b.id = u.id`;
  await tx`
    update bibliographic_references b set secondary_count = u.n
    from (select r.secondary_reference_id as id, count(*)::int as n from trait_records r
          where r.secondary_reference_id is not null
            and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
          group by 1) u
    where b.id = u.id`;
  await tx`delete from species_trait_coverage`;
  await tx`
    insert into species_trait_coverage (species_id, trait_id, record_count, harmonised_count, first_record_at, last_record_at)
    select r.species_id, r.trait_id, count(*), count(*) filter (where r.harmonisation = 'harmonised'),
      min(r.created_at), max(r.created_at)
    from trait_records r
    where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
    group by 1, 2`;
  await tx`update species set trait_count = 0 where trait_count <> 0`;
  await tx`
    update species s set trait_count = c.n
    from (select species_id, count(*)::int as n from species_trait_coverage group by 1) c
    where s.id = c.species_id`;
  await tx`delete from reference_traits`;
  // 0027's UNION over DISTINCT (record, reference, trait) triples (a
  // reference in both roles counts once), plus record_references on its own.
  await tx`
    insert into reference_traits (reference_id, trait_id, record_count)
    select reference_id, trait_id, count(*) from (
      select reference_id, trait_id from (
        select distinct r.id, r.primary_reference_id as reference_id, r.trait_id from trait_records r
        where r.primary_reference_id is not null
          and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
        union
        select distinct r.id, r.secondary_reference_id, r.trait_id from trait_records r
        where r.secondary_reference_id is not null
          and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
      ) d
      union all
      select rr.reference_id, r.trait_id from record_references rr join trait_records r on r.id = rr.record_id
      where not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
    ) x group by 1, 2`;
}

/**
 * RFC-64 R15 steps 4–5, after the new file's records are inserted and before
 * the batch is recorded:
 * - Re-attach by `record_code`.
 * - Restore the triggers.
 * - Recompute the counters.
 * - Write the final sheet beside the pending one, as `<sheet>.tmp`.
 *   {@link publishSheet} renames it after COMMIT.
 * @rfc RFC-64 R15
 * @rfc RFC-63 R2, R4
 */
export async function relinkImported(
  tx: TransactionSql,
  detached: DetachedImported,
): Promise<void> {
  // Same id, actor, kind, note, reference, generated and created_at; only the
  // record changes. The re-inserted withdrawal fires
  // record_annotations_withdraw_counters; the recompute below supersedes it.
  await tx`
    insert into record_annotations (id, record_id, actor_id, kind, note, reference_id, generated, created_at)
    select s.id, r.id, s.actor_id, s.kind, s.note, s.reference_id, s.generated, s.created_at
    from replace_annotations s
    join trait_records r on r.record_code = s.record_code and r.origin = 'import'`;
  // RFC-63 R2: a response names a record of its own species and trait. The
  // trigger that checks it fires on INSERT only, so the join checks it here.
  await tx`
    update trait_records k set intent = l.intent, responds_to_record_id = r.id
    from replace_links l
    join trait_records r on r.record_code = l.target_code and r.origin = 'import'
    where l.link = 'responds_to' and l.id = k.id
      and r.species_id = k.species_id and r.trait_id = k.trait_id`;
  await tx`
    update trait_records k set supersedes_record_id = r.id
    from replace_links l
    join trait_records r on r.record_code = l.target_code and r.origin = 'import'
    where l.link = 'supersedes' and l.id = k.id
      and r.species_id = k.species_id and r.trait_id = k.trait_id`;
  // An orphaned harmonisation with a primary reference stands on its own.
  await tx`
    update trait_records k set supersedes_record_id = null
    from replace_links l
    where l.link = 'supersedes' and l.id = k.id
      and k.supersedes_record_id = k.id and k.primary_reference_id is not null`;
  // A harmonisation whose EB_ record is gone and that has no primary
  // reference would be a manual record with no reference at all
  // (trait_records_origin_check). Stop here; the rollback restores everything.
  const stuck = await tx<{ own: string; target: string }[]>`
    select k.record_code as own, l.target_code as target
    from replace_links l join trait_records k on k.id = l.id
    where l.link = 'supersedes' and k.supersedes_record_id = k.id
    order by 1`;
  if (stuck.length > 0) {
    throw new Error(
      `Cannot orphan a harmonisation without a primary reference: ${stuck
        .map((s) => `${s.own} harmonises ${s.target}`)
        .join('; ')}. Put these rows back in the file (RFC-64 R15)`,
    );
  }
  for (const [table, trigger] of R15_TRIGGERS) {
    await tx`alter table ${tx(table)} enable trigger ${tx(trigger)}`;
  }
  await recomputeCounters(tx);
  const relinked = await tx<{ key: string }[]>`
    select 'a:' || s.id as key from replace_annotations s
    where exists (select 1 from record_annotations a where a.id = s.id)
    union all
    select 'l:' || l.link || ':' || l.id from replace_links l
    join trait_records k on k.id = l.id
    where (l.link = 'responds_to' and k.responds_to_record_id is not null)
       or (l.link = 'supersedes' and k.supersedes_record_id is not null)`;
  const keys = new Set(relinked.map((r) => r.key));
  await writeSheet(`${detached.path}.tmp`, detached.rows, (row) =>
    keys.has(row.key) ? 'relinked' : 'orphan',
  );
}

/** After COMMIT: the final sheet takes the pending one's place in one rename. @rfc RFC-64 R15 */
export async function publishSheet(detached: DetachedImported): Promise<void> {
  await rename(`${detached.path}.tmp`, detached.path);
}
