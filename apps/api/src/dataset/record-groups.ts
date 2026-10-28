import type {
  DispersalPhase,
  RecordGroup,
  RecordGroupSort,
  RecordItem,
  SortOrder,
} from '@treerepro/contracts';
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

type KeyType = 'text' | 'bigint' | 'timestamptz';

interface GroupRow {
  k6: string;
  sort_keys: string[];
  record_code: string;
  n_records: number;
  n_references: number;
  validation_count: number;
  contest_count: number;
  contested: boolean;
  origin: RecordItem['origin'] | null;
  harmonisation: RecordItem['harmonisation'] | null;
  created_iso: string;
  sample_id: string;
}

const VALIDATE: Record<KeyType, (part: string) => boolean> = {
  text: () => true,
  bigint: (p) => /^-?\d{1,18}$/.test(p),
  // PostgreSQL's text form of a timestamptz, e.g. `2026-10-28 09:30:05.123456+00`.
  timestamptz: (p) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.test(p),
};

/**
 * Each order of the groups as key expressions over the `groups` CTE's columns
 * (RFC-63 R18): `default` is R18's fixed order, the others its `sort` values;
 * `k6`, the stable group key, always breaks the tie. Every key is coalesced,
 * so `NULL` never reaches the keyset's row-value comparison.
 */
const SORTS: Record<RecordGroupSort | 'default', { keys: string[]; types: KeyType[] }> = {
  default: {
    keys: ['k1', 'k2', 'k3', 'k4', 'k5'],
    types: ['bigint', 'text', 'bigint', 'text', 'text'],
  },
  code: {
    keys: [
      "substring(record_code from '^[A-Z]+')",
      "substring(record_code from '_([0-9]+)')::bigint",
      "coalesce(substring(record_code from '[a-z]+$'), '')",
    ],
    types: ['text', 'bigint', 'text'],
  },
  value: { keys: ['k2'], types: ['text'] },
  references: { keys: ['n_references'], types: ['bigint'] },
  secondary: { keys: ['k4', 'k5'], types: ['text', 'text'] },
  origin: { keys: ["coalesce(origin, '')"], types: ['text'] },
  harmonisation: { keys: ["coalesce(harmonisation, '')"], types: ['text'] },
  counts: { keys: ['validation_count', 'contest_count'], types: ['bigint', 'bigint'] },
  added: { keys: ['created_at'], types: ['timestamptz'] },
};

/**
 * The visible records of one species × trait (one phase with
 * `dispersalPhase`) in groups of level × secondary reference, a record with no
 * level a group of its own, in RFC-63 R18's fixed order or by `sort` and
 * `order`, under a composite keyset cursor that names its sort and order
 * ahead of the keys and the group key (RFC-11 R6, R10) — so a cursor of one
 * sort is refused under another. Each group's sample record goes through the
 * records list's own item query, so a group's level and secondary reference,
 * and a lone record's item, read exactly as the list shows them.
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
    sort?: RecordGroupSort;
    order?: SortOrder;
    cursor?: string;
    limit: number;
  },
): Promise<{ data: RecordGroup[]; nextCursor: string | null }> {
  const sortName = input.sort ?? 'default';
  const order = input.order ?? 'asc';
  const spec = SORTS[sortName];
  const keyCols = sql.raw(spec.keys.map((k, i) => `${k} as s${i}`).join(', '));
  const keyList = sql.raw(spec.keys.map((_, i) => `s${i}`).join(', '));
  const keyText = sql.raw(`array[${spec.keys.map((_, i) => `s${i}::text`).join(', ')}]`);
  const orderBy = sql.raw(
    [...spec.keys.map((_, i) => `s${i}`), 'k6'].map((k) => `${k} ${order}`).join(', '),
  );
  let after: SQL = sql`true`;
  if (input.cursor) {
    const parts = decodeCompositeCursor(input.cursor, spec.keys.length + 3, [
      (p) => p === sortName,
      (p) => p === order,
      ...spec.types.map((t) => VALIDATE[t]),
      () => true,
    ]);
    const values = spec.types.map((t, i) => sql`${parts[i + 2]}::${sql.raw(t)}`);
    const rhs = sql.join([...values, sql`${parts[spec.keys.length + 2]}`], sql`, `);
    after = sql`(${keyList}, k6) ${sql.raw(order === 'asc' ? '>' : '<')} (${rhs})`;
  }
  const phase = input.dispersalPhase
    ? sql`${traitRecords.dispersalPhase} = ${input.dispersalPhase}`
    : sql`true`;
  // A record's reference (R18): its primary reference, else its secondary one.
  const rows = (await db.execute(sql`
    with recs as (
      select ${traitRecords.id} as id, ${traitRecords.levelId} as level_id,
        ${traitRecords.secondaryReferenceId} as secondary_id, ${traitRecords.valueText} as value_text,
        ${traitRecords.recordCode} as record_code, ${traitRecords.origin} as origin,
        ${traitRecords.harmonisation} as harmonisation, ${traitRecords.createdAt} as created_at,
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
        (array_agg(g.record_code order by
          substring(g.record_code from '^[A-Z]+'),
          substring(g.record_code from '_([0-9]+)')::bigint,
          substring(g.record_code from '[a-z]+$') nulls first))[1] as record_code,
        count(*)::int as n_records,
        count(distinct g.ref_id)::int as n_references,
        (select count(distinct a.actor_id) from ${recordAnnotations} a
          where a.kind = 'confirm' and a.record_id = any(array_agg(g.id)))::int as validation_count,
        max(g.contest_count)::int as contest_count,
        bool_or(g.contested) as contested,
        case when count(distinct g.origin) = 1 then min(g.origin) end as origin,
        case when count(distinct g.harmonisation) = 1 then min(g.harmonisation) end as harmonisation,
        max(g.created_at) as created_at,
        (array_agg(g.id order by g.id))[1] as sample_id
      from (select recs.*, case when level_id is null then id end as lone_id from recs) g
      left join level_refs lr on lr.level_id = g.level_id
      left join ${traitLevels} lvl on lvl.id = g.level_id
      left join ${bibliographicReferences} sec on sec.id = g.secondary_id
      group by g.level_id, g.secondary_id, g.lone_id, lr.n, lvl.key, sec.short_citation, sec.citation_key
    )
    select *, ${keyText} as sort_keys, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_iso from (
      select groups.*, ${keyCols} from groups
    ) keyed
    where ${after}
    order by ${orderBy}
    limit ${input.limit + 1}`)) as unknown as GroupRow[];

  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([sortName, order, ...r.sort_keys, r.k6]),
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
      recordCode: r.record_code,
      nRecords: r.n_records,
      nReferences: r.n_references,
      origin: r.origin,
      harmonisation: r.harmonisation,
      createdAt: r.created_iso,
      validationCount: r.validation_count,
      contestCount: r.contest_count,
      contested: r.contested,
      record: r.n_records === 1 ? sample : null,
    };
  });
  return { data, nextCursor };
}
