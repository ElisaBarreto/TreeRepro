import type { DispersalPhase, RecordGroup } from '@treerepro/contracts';
import { inArray, type SQL, sql } from 'drizzle-orm';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { decodeCompositeCursor, encodeCompositeCursor, pageOf } from '../http/cursor.ts';
import { contestCountSql, recordContestedSql } from './contests.ts';
import { itemQuery, recordVisible, toItem } from './records.ts';

interface GroupRow {
  k1: number;
  k2: string;
  k3: number;
  k4: string;
  k5: string;
  k6: string;
  n_records: number;
  n_references: number;
  validation_count: number;
  contest_count: number;
  contested: boolean;
  sample_id: string;
}

const isInt = (p: string) => /^-?\d{1,10}$/.test(p);
const anyText = () => true;

/**
 * The visible records of one species × trait (one phase with
 * `dispersalPhase`) in groups of level × secondary reference, a record with no
 * level a group of its own, in RFC-63 R18's fixed order under a composite
 * keyset cursor of that order's six keys (RFC-11 R6). Each group's sample
 * record goes through the records list's own item query, so a group's level
 * and secondary reference, and a lone record's item, read exactly as the list
 * shows them.
 * @rfc RFC-63 R18
 * @rfc RFC-33 R2, R3
 */
export async function recordGroups(
  db: DbExecutor,
  visibility: Visibility,
  input: {
    speciesId: string;
    traitId: string;
    dispersalPhase?: DispersalPhase;
    cursor?: string;
    limit: number;
  },
): Promise<{ data: RecordGroup[]; nextCursor: string | null }> {
  let after: SQL = sql`true`;
  if (input.cursor) {
    const [k1, k2, k3, k4, k5, k6] = decodeCompositeCursor(input.cursor, 6, [
      isInt,
      anyText,
      isInt,
      anyText,
      anyText,
      anyText,
    ]) as [string, string, string, string, string, string];
    after = sql`(k1, k2, k3, k4, k5, k6) > (${Number(k1)}::int, ${k2}, ${Number(k3)}::int, ${k4}, ${k5}, ${k6})`;
  }
  const phase = input.dispersalPhase
    ? sql`${traitRecords.dispersalPhase} = ${input.dispersalPhase}`
    : sql`true`;
  // A record's reference (R18): its primary reference, else its secondary one.
  const rows = (await db.execute(sql`
    with recs as (
      select ${traitRecords.id} as id, ${traitRecords.levelId} as level_id,
        ${traitRecords.secondaryReferenceId} as secondary_id, ${traitRecords.valueText} as value_text,
        coalesce(${traitRecords.primaryReferenceId}, ${traitRecords.secondaryReferenceId}) as ref_id,
        ${contestCountSql(sql`${traitRecords.id}`)} as contest_count,
        ${recordContestedSql(visibility, sql`${traitRecords.id}`)} as contested
      from ${traitRecords}
      join ${species} on ${species.id} = ${traitRecords.speciesId}
      join ${traits} on ${traits.id} = ${traitRecords.traitId}
      where ${traitRecords.speciesId} = ${input.speciesId}
        and ${traitRecords.traitId} = ${input.traitId}
        and ${phase}
        and ${speciesVisible(visibility)} and ${traitVisible(visibility)}
        and ${recordVisible(visibility)}
    ),
    level_refs as (
      select level_id, count(distinct ref_id)::int as n from recs
      where level_id is not null group by level_id
    ),
    groups as (
      select
        case when g.level_id is null then 1 else -lr.n end as k1,
        coalesce(lvl.key, min(g.value_text)) as k2,
        -count(distinct g.ref_id)::int as k3,
        coalesce(sec.short_citation, '') as k4,
        coalesce(sec.citation_key, '') as k5,
        coalesce(g.level_id::text || ':' || coalesce(g.secondary_id::text, 'none'), g.lone_id::text) as k6,
        count(*)::int as n_records,
        count(distinct g.ref_id)::int as n_references,
        (select count(distinct a.actor_id) from ${recordAnnotations} a
          where a.kind = 'confirm' and a.record_id = any(array_agg(g.id)))::int as validation_count,
        max(g.contest_count)::int as contest_count,
        bool_or(g.contested) as contested,
        (array_agg(g.id order by g.id))[1] as sample_id
      from (select recs.*, case when level_id is null then id end as lone_id from recs) g
      left join level_refs lr on lr.level_id = g.level_id
      left join ${traitLevels} lvl on lvl.id = g.level_id
      left join ${bibliographicReferences} sec on sec.id = g.secondary_id
      group by g.level_id, g.secondary_id, g.lone_id, lr.n, lvl.key, sec.short_citation, sec.citation_key
    )
    select * from groups
    where ${after}
    order by k1, k2, k3, k4, k5, k6
    limit ${input.limit + 1}`)) as unknown as GroupRow[];

  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([String(r.k1), r.k2, String(r.k3), r.k4, r.k5, r.k6]),
  );
  const samples =
    page.length === 0
      ? []
      : await itemQuery(db, visibility).where(
          inArray(
            traitRecords.id,
            page.map((r) => r.sample_id),
          ),
        );
  const items = new Map(samples.map((s) => [s.record.id, toItem(s)]));
  const data = page.map((r): RecordGroup => {
    const sample = items.get(r.sample_id);
    if (!sample) throw new Error(`recordGroups: sample ${r.sample_id} vanished`);
    return {
      level: sample.level,
      secondaryReference: sample.secondaryReference,
      nRecords: r.n_records,
      nReferences: r.n_references,
      validationCount: r.validation_count,
      contestCount: r.contest_count,
      contested: r.contested,
      record: r.n_records === 1 ? sample : null,
    };
  });
  return { data, nextCursor };
}
