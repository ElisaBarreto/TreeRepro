import type {
  ContestedQueueItem,
  MapPendingBody,
  MapResult,
  PendingGroup,
  PendingTrait,
} from '@treerepro/contracts';
import { and, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { contestLevels, contestRecords, contests } from '../db/schema/contests.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import {
  decodeCompositeCursor,
  decodeCursor,
  encodeCompositeCursor,
  encodeCursor,
  isDigits,
  isUuid,
  pageOf,
} from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { contestStandingSql, contestVisibleSql, levelContestedSql } from './contests.ts';
import { requireTrait, resolveValue } from './curation.ts';
import { itemQuery, recordVisible, toItem } from './records.ts';

/**
 * The RFC-65 R7 pending predicate over a `trait_records` alias `r`: an
 * unharmonisable import value that no record supersedes yet. The redundant
 * `<> 'harmonised'` lets the planner use the partial index.
 * @rfc RFC-65 R7
 */
const PENDING = sql`r.harmonisation <> 'harmonised'
  and r.harmonisation in ('unknown_level', 'multi_value', 'not_numeric')
  and not exists (select 1 from trait_records c where c.supersedes_record_id = r.id)
  and not exists (select 1 from record_annotations pw where pw.record_id = r.id and pw.kind = 'withdraw')`;

/**
 * The rows behind every pending queue: `PENDING` over a `trait_records r`
 * joined to `species s` and `traits t`, narrowed to the viewer (RFC-33 R2, R3)
 * and, when a trait is given, to that trait. The traits, the groups and the
 * count all select through it, so the number on the dashboard can never
 * describe a different set of rows from the queue it links to.
 * @rfc RFC-65 R7, R8
 * @rfc RFC-33 R2, R3
 */
function pendingWhere(visibility: Visibility, traitId?: string): SQL {
  const scope = traitId === undefined ? sql`true` : sql`r.trait_id = ${traitId}::uuid`;
  return sql`${PENDING}
    and ${scope}
    and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
    and ${traitVisible(visibility, sql`t.active`)}`;
}

interface PendingTraitRow {
  trait_id: string;
  trait_key: string;
  value_type: PendingTrait['trait']['valueType'];
  unit: string | null;
  count: number;
}

/**
 * @rfc RFC-65 R8
 * @rfc RFC-33 R2, R3
 */
export async function pendingTraits(
  db: DbExecutor,
  visibility: Visibility,
): Promise<PendingTrait[]> {
  const rows = (await db.execute(sql`
    select t.id as trait_id, t.key as trait_key, t.value_type, t.unit, count(*)::int as count
    from trait_records r
    join traits t on t.id = r.trait_id
    join species s on s.id = r.species_id
    where ${pendingWhere(visibility)}
    group by t.id, t.key, t.value_type, t.unit
    order by count desc, t.key`)) as unknown as PendingTraitRow[];
  return rows.map((r) => ({
    trait: { id: r.trait_id, key: r.trait_key, valueType: r.value_type, unit: r.unit },
    count: r.count,
  }));
}

interface GroupRow {
  value_text: string;
  harmonisation: PendingGroup['harmonisation'];
  count: number;
  sample_record_id: string;
}

const isCount = (part: string) => isDigits(part) && Number.isSafeInteger(Number(part));

/**
 * Groups of one trait's pending records by value; composite cursor
 * `[count, sampleRecordId]` — `sampleRecordId` (a fixed-size uuid) re-derives
 * the group's `value_text` through a subquery on `trait_records` rather than
 * carrying the text itself, which can run to 4000 characters and would push
 * the base64url-encoded cursor past `cursorQuerySchema`'s 4096-character cap.
 * @rfc RFC-65 R8
 * @rfc RFC-33 R2, R3
 */
export async function pendingGroups(
  db: DbExecutor,
  visibility: Visibility,
  input: { traitId: string; cursor?: string; limit: number },
): Promise<{ data: PendingGroup[]; nextCursor: string | null }> {
  await requireTrait(db, visibility, input.traitId);
  let after: SQL = sql`true`;
  if (input.cursor) {
    const [count, sampleRecordId] = decodeCompositeCursor(input.cursor, 2, [isCount, isUuid]) as [
      string,
      string,
    ];
    after = sql`(count(*) < ${Number(count)}::bigint
      or (count(*) = ${Number(count)}::bigint
        and r.value_text > (select s.value_text from trait_records s where s.id = ${sampleRecordId}::uuid)))`;
  }
  // `max(uuid)` does not exist; the ordered array_agg picks the newest id.
  // One group per distinct value_text (RFC-65 R8): a categorical value's rows
  // may disagree on harmonisation (unknown_level vs multi_value), so the
  // group's harmonisation is the least of them, not part of the grouping key.
  const rows = (await db.execute(sql`
    select r.value_text, min(r.harmonisation) as harmonisation, count(*)::int as count,
      (array_agg(r.id order by r.id desc))[1] as sample_record_id
    from trait_records r
    join species s on s.id = r.species_id
    join traits t on t.id = r.trait_id
    where ${pendingWhere(visibility, input.traitId)}
    group by r.value_text
    having ${after}
    order by count desc, r.value_text asc
    limit ${input.limit + 1}`)) as unknown as GroupRow[];
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([String(r.count), r.sample_record_id]),
  );
  return {
    data: page.map((r) => ({
      valueText: r.value_text,
      harmonisation: r.harmonisation,
      count: r.count,
      sampleRecordId: r.sample_record_id,
    })),
    nextCursor,
  };
}

/**
 * How many groups the pending queue holds over every visible trait — the same
 * rows `pendingGroups` pages through, grouped the same way (RFC-65 R8), for
 * the dashboard's `queues.pendingGroups` (RFC-72 R1).
 * @rfc RFC-65 R8
 * @rfc RFC-72 R1
 * @rfc RFC-33 R2, R3
 */
export async function countPendingGroups(db: DbExecutor, visibility: Visibility): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(*)::int as count from (
      select r.trait_id
      from trait_records r
      join species s on s.id = r.species_id
      join traits t on t.id = r.trait_id
      where ${pendingWhere(visibility)}
      group by r.trait_id, r.value_text) groups`)) as unknown as [{ count: number } | undefined];
  return row?.count ?? 0;
}

export interface MapPendingInput {
  actorId: string;
  traitId: string;
  valueText: string;
  value: MapPendingBody['value'];
  note?: string;
}

/**
 * Bulk harmonisation of one group: every pending row of the group × every
 * chosen level (or the one number) becomes a manual record that supersedes
 * its original, in one INSERT … SELECT. Claims that already exist are left
 * alone and counted as skipped.
 * @rfc RFC-65 R7, R9
 * @rfc RFC-33 R5
 */
export async function mapPending(
  db: DbExecutor,
  visibility: Visibility,
  input: MapPendingInput,
): Promise<MapResult> {
  const trait = await requireTrait(db, visibility, input.traitId);
  if (!trait.active)
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path: 'traitId', message: 'Trait is inactive' },
    ]);
  const levels: { id: string; key: string }[] = [];
  let numeric: string | null = null;
  if ('levelIds' in input.value) {
    for (const levelId of input.value.levelIds) {
      const resolved = await resolveValue(db, visibility, trait, { levelId });
      if (resolved.levelId !== null) levels.push({ id: resolved.levelId, key: resolved.levelKey });
    }
  } else {
    // `resolveValue` reports an out-of-range number at `value.quantitative.single`
    // (its own value shape); `mapPending`'s own body takes `value.numeric`
    // (unchanged by plan 13f), and that is the path the web MapDialog reads
    // its error off of, so the detail is remapped back before it leaves here.
    try {
      await resolveValue(db, visibility, trait, { quantitative: { single: input.value.numeric } });
    } catch (err) {
      if (err instanceof AppError && err.details) {
        throw new AppError(
          err.code,
          err.message,
          err.details.map((d) =>
            d.path === 'value.quantitative.single' ? { ...d, path: 'value.numeric' } : d,
          ),
        );
      }
      throw err;
    }
    numeric = String(input.value.numeric);
  }
  const chosenCount = levels.length === 0 ? 1 : levels.length;
  const chosen =
    levels.length === 0
      ? sql`select null::uuid as level_id, null::text as level_key`
      : sql`select * from (values ${sql.join(
          levels.map((l) => sql`(${l.id}::uuid, ${l.key}::text)`),
          sql`, `,
        )}) as v(level_id, level_key)`;
  const group = sql`r.trait_id = ${input.traitId} and r.value_text = ${input.valueText} and ${PENDING}`;
  return db.transaction(async (tx) => {
    // The pending count and the insert come from one statement (and so one
    // snapshot): a separate earlier count could disagree with the insert's
    // own view of `pending` under READ COMMITTED, if a concurrent import adds
    // rows to the group in between.
    const [result] = (await tx.execute(sql`
      with pending as (
        select r.id, r.species_id, r.primary_reference_id, r.secondary_reference_id,
          coalesce(r.raw_value, r.value_text) as raw_value
        from trait_records r
        join species s on s.id = r.species_id
        where ${group} and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}),
      chosen as (${chosen}),
      ins as (
        insert into trait_records (species_id, trait_id, level_id, numeric_value, value_text, harmonisation,
          raw_value, primary_reference_id, secondary_reference_id, origin, created_by, note, supersedes_record_id)
        select p.species_id, ${input.traitId}, c.level_id, ${numeric}::numeric,
          coalesce(c.level_key, (${numeric}::numeric)::text), 'harmonised', p.raw_value,
          p.primary_reference_id, p.secondary_reference_id, 'manual', ${input.actorId}, ${input.note ?? null}, p.id
        from pending p cross join chosen c
        on conflict on constraint trait_records_claim_key do nothing
        returning 1)
      select (select count(*)::int from pending) as pending, (select count(*)::int from ins) as created`)) as unknown as [
      { pending: number; created: number },
    ];
    const created = result?.created ?? 0;
    return { created, skipped: (result?.pending ?? 0) * chosenCount - created };
  });
}

/**
 * The standing contests (RFC-63 R14) the viewer may see — species, trait and
 * every level each names (RFC-33 R2) — over a `contests` table in the
 * caller's query. The queue pages through it and the count counts it, so the
 * tile and the page can never disagree.
 * @rfc RFC-65 R10
 * @rfc RFC-33 R2, R3
 */
function contestedWhere(visibility: Visibility): SQL {
  return sql`${contestStandingSql(visibility, 'contests')} and ${contestVisibleSql(visibility, contests.id)}`;
}

/**
 * How many contests stand, for the dashboard, the health page and the digest
 * (RFC-72 R1, RFC-52 R1, RFC-74 R3).
 * @rfc RFC-65 R10
 * @rfc RFC-72 R1
 * @rfc RFC-33 R2, R3
 */
export async function countContested(db: DbExecutor, visibility: Visibility): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contests)
    .where(contestedWhere(visibility));
  return row?.count ?? 0;
}

/**
 * One page of the standing contests, newest first (keyset on the contest id,
 * a uuidv7). Four queries whatever the page size, never one per row: the page
 * (the author's name through Drizzle, which decrypts it, RFC-40), the named
 * levels with their contested flag, the created records with their targets,
 * and the record items through the shared item join.
 * @rfc RFC-65 R10
 * @rfc RFC-33 R2, R3
 */
export async function listContested(
  db: DbExecutor,
  visibility: Visibility,
  input: { cursor?: string; limit: number },
): Promise<{ data: ContestedQueueItem[]; nextCursor: string | null }> {
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = await db
    .select({
      id: contests.id,
      speciesId: contests.speciesId,
      canonicalName: species.canonicalName,
      traitId: contests.traitId,
      traitKey: traits.key,
      valueType: traits.valueType,
      createdById: users.id,
      createdByName: users.name,
      createdAt: contests.createdAt,
    })
    .from(contests)
    .innerJoin(species, eq(species.id, contests.speciesId))
    .innerJoin(traits, eq(traits.id, contests.traitId))
    .innerJoin(users, eq(users.id, contests.createdBy))
    .where(and(contestedWhere(visibility), after === null ? undefined : lt(contests.id, after)))
    .orderBy(desc(contests.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.id));
  if (page.length === 0) return { data: [], nextCursor };
  const ids = page.map((r) => r.id);

  const [levels, created] = await Promise.all([
    db
      .select({
        contestId: contestLevels.contestId,
        levelId: contestLevels.levelId,
        key: traitLevels.key,
        contested: sql<boolean>`${levelContestedSql(
          visibility,
          sql`${contests.speciesId}`,
          sql`${contests.traitId}`,
          sql`${contestLevels.levelId}`,
        )}`,
      })
      .from(contestLevels)
      .innerJoin(contests, eq(contests.id, contestLevels.contestId))
      .innerJoin(traitLevels, eq(traitLevels.id, contestLevels.levelId))
      .where(inArray(contestLevels.contestId, ids))
      .orderBy(traitLevels.key),
    db
      .select({
        contestId: contestRecords.contestId,
        recordId: contestRecords.recordId,
        targetId: traitRecords.respondsToRecordId,
      })
      .from(contestRecords)
      .innerJoin(traitRecords, eq(traitRecords.id, contestRecords.recordId))
      .where(inArray(contestRecords.contestId, ids))
      .orderBy(traitRecords.recordCode),
  ]);
  const itemIds = [
    ...new Set(created.flatMap((c) => (c.targetId ? [c.recordId, c.targetId] : [c.recordId]))),
  ];
  // Only records the viewer can see; a contest's species and trait are its
  // records' own, and the contest filter above already checked them.
  const items =
    itemIds.length === 0
      ? []
      : await itemQuery(db, visibility).where(
          and(inArray(traitRecords.id, itemIds), recordVisible(visibility)),
        );
  const itemById = new Map(items.map((i) => [i.record.id, toItem(i)]));

  const data = page.map((r): ContestedQueueItem => {
    const own = created.filter((c) => c.contestId === r.id);
    const quantitative = r.valueType === 'quantitative';
    const targetId = own.find((c) => c.targetId !== null)?.targetId;
    return {
      id: r.id,
      species: { id: r.speciesId, canonicalName: r.canonicalName },
      trait: { id: r.traitId, key: r.traitKey },
      createdBy: { id: r.createdById, name: r.createdByName },
      createdAt: r.createdAt.toISOString(),
      levels: quantitative
        ? null
        : levels
            .filter((l) => l.contestId === r.id)
            .map((l) => ({ levelId: l.levelId, key: l.key, contested: l.contested })),
      target: quantitative && targetId ? (itemById.get(targetId) ?? null) : null,
      records: own.flatMap((c) => {
        const item = itemById.get(c.recordId);
        return item ? [item] : [];
      }),
    };
  });
  return { data, nextCursor };
}
