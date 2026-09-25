import type {
  DisputedRecord,
  MapPendingBody,
  MapResult,
  PendingGroup,
  PendingTrait,
} from '@treerepro/contracts';
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitRecords } from '../db/schema/records.ts';
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
import { requireTrait, resolveValue } from './curation.ts';
import { itemQuery, toItem } from './records.ts';

/**
 * The RFC-65 R7 pending predicate over a `trait_records` alias `r`: an
 * unharmonisable import value that no record supersedes yet. The redundant
 * `<> 'harmonised'` lets the planner use the partial index.
 * @rfc RFC-65 R7
 */
const PENDING = sql`r.harmonisation <> 'harmonised'
  and r.harmonisation in ('unknown_level', 'multi_value', 'not_numeric')
  and not exists (select 1 from trait_records c where c.supersedes_record_id = r.id)`;

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
    const resolved = await resolveValue(db, visibility, trait, { numeric: input.value.numeric });
    numeric = String(resolved.numericValue);
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

interface DisputeRow {
  record_id: string;
  annotation_id: string;
  actor_id: string;
  note: string | null;
  created_at: Date | string;
}

/** No actor has withdrawn the record (RFC-63 R6). The id is wrapped as `reviewStatusSql` wraps it. */
function notWithdrawn(recordId: SQL): SQL {
  return sql`not exists (select 1 from record_annotations w
    where w.record_id = ${recordId} and w.kind = 'withdraw')`;
}

/**
 * The standing disputes as a query: per record, the newest annotation among
 * the actors whose latest stance is `dispute`; excluded once withdrawn, and,
 * with `intent = 'contest'`, kept only when a contest generated that
 * standing annotation (RFC-70 R3). Starts from `record_annotations`
 * (human-scale), never scans `trait_records`. `listDisputed` appends its
 * keyset and order to it and `countDisputed` counts it, so the dashboard's
 * number and the queue it links to are the same rows by construction.
 * @rfc RFC-65 R10
 * @rfc RFC-33 R2, R3
 */
function disputedQuery(visibility: Visibility, intent?: 'contest'): SQL {
  return sql`
    with stances as (
      select distinct on (a.record_id, a.actor_id) a.record_id, a.actor_id, a.id, a.kind, a.note, a.generated, a.created_at
      from record_annotations a where a.kind <> 'withdraw'
      order by a.record_id, a.actor_id, a.id desc),
    standing as (
      select distinct on (s.record_id) s.record_id, s.id as annotation_id, s.actor_id, s.note, s.generated, s.created_at
      from stances s where s.kind = 'dispute'
      order by s.record_id, s.id desc)
    select d.record_id, d.annotation_id, d.actor_id, d.note, d.created_at
    from standing d
    join trait_records r on r.id = d.record_id
    join species sp on sp.id = r.species_id
    join traits tr on tr.id = r.trait_id
    where ${notWithdrawn(sql`d.record_id`)}
      and ${intent === 'contest' ? sql`d.generated` : sql`true`}
      and ${speciesVisible(visibility, sql`sp.active`, sql`sp.id`)}
      and ${traitVisible(visibility, sql`tr.active`)}`;
}

/**
 * How many records stand disputed, for the dashboard's `queues.disputed`
 * (RFC-72 R1) — the rows `listDisputed` pages through, counted.
 * @rfc RFC-65 R10
 * @rfc RFC-72 R1
 * @rfc RFC-33 R2, R3
 */
export async function countDisputed(db: DbExecutor, visibility: Visibility): Promise<number> {
  const [row] = (await db.execute(
    sql`select count(*)::int as count from (${disputedQuery(visibility)}) disputed`,
  )) as unknown as [{ count: number } | undefined];
  return row?.count ?? 0;
}

/**
 * How many contests are open, for the dashboard's `queues.contested`
 * (RFC-72 R1, `docs/specs/2026-09-17-workspace-design.md` §4 R1): records with
 * `intent = 'contest'` whose responded record is not withdrawn.
 *
 * **This number and the `?intent=contest` queue it links to may legitimately
 * differ, and neither is wrong.** This counts contest *records*; that queue
 * lists their *targets* (RFC-65 R10), so a record contested twice is two
 * contests and one queue row. A contest withdrawn while another of the same
 * actor still stands also keeps counting here, because the rule conditions on
 * the responded record, while the queue drops a target once the last contest
 * against it is withdrawn and its generated dispute turns neutral (RFC-70 R5).
 * Do not "reconcile" the two by narrowing this predicate: the rule is the
 * specification, and the tile would then report something it does not name.
 * The two predicates shared with `disputedQuery` keep them in step on
 * everything the rule does hold in common.
 *
 * The leading `responds_to_record_id is not null` is redundant against the
 * check constraint `trait_records_intent_check` and deliberate, exactly as
 * `PENDING`'s redundant `<> 'harmonised'` is: `trait_records_responds_to_idx`
 * is partial on that predicate, so without stating it the planner cannot use
 * the index and every reviewer's page load scans `trait_records` — there is
 * no index on `intent`, and this runs uncached on every dashboard call.
 * @rfc RFC-65 R10
 * @rfc RFC-72 R1
 * @rfc RFC-33 R2, R3
 */
export async function countContested(db: DbExecutor, visibility: Visibility): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(*)::int as count
    from trait_records c
    join trait_records b on b.id = c.responds_to_record_id
    join species sp on sp.id = c.species_id
    join traits tr on tr.id = c.trait_id
    where c.responds_to_record_id is not null
      and c.intent = 'contest'
      and ${notWithdrawn(sql`b.id`)}
      and ${speciesVisible(visibility, sql`sp.active`, sql`sp.id`)}
      and ${traitVisible(visibility, sql`tr.active`)}`)) as unknown as [
    { count: number } | undefined,
  ];
  return row?.count ?? 0;
}

/**
 * One page of the standing disputes, newest first. Three steps: the page of
 * dispute rows, then the record items through the shared join, the actors
 * through Drizzle so their names are decrypted (RFC-40), and the contests
 * standing behind the page's records — one query each, never one per row.
 * @rfc RFC-65 R10
 * @rfc RFC-33 R2, R3
 */
export async function listDisputed(
  db: DbExecutor,
  visibility: Visibility,
  input: { cursor?: string; limit: number; intent?: 'contest' },
): Promise<{ data: DisputedRecord[]; nextCursor: string | null }> {
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = (await db.execute(sql`${disputedQuery(visibility, input.intent)}
      and (${after}::uuid is null or d.annotation_id < ${after}::uuid)
    order by d.annotation_id desc
    limit ${input.limit + 1}`)) as unknown as DisputeRow[];
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.annotation_id));
  if (page.length === 0) return { data: [], nextCursor };
  const recordIds = page.map((r) => r.record_id);
  const [items, actors, contests] = await Promise.all([
    itemQuery(db).where(inArray(traitRecords.id, recordIds)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(page.map((r) => r.actor_id))])),
    db
      .select({
        id: traitRecords.id,
        respondsToRecordId: traitRecords.respondsToRecordId,
        valueText: traitRecords.valueText,
        createdById: traitRecords.createdBy,
        createdByName: users.name,
      })
      .from(traitRecords)
      .leftJoin(users, eq(users.id, traitRecords.createdBy))
      .where(
        and(
          inArray(traitRecords.respondsToRecordId, recordIds),
          eq(traitRecords.intent, 'contest'),
          notWithdrawn(sql`${traitRecords.id}`),
        ),
      )
      .orderBy(desc(traitRecords.id)),
  ]);
  const itemById = new Map(items.map((i) => [i.record.id, toItem(i)]));
  const actorById = new Map(actors.map((a) => [a.id, a]));
  // `trait_records.id` is a uuidv7, so id descending is newest first (RFC-65 R10).
  const contestsByRecord = new Map<string, DisputedRecord['contestedBy']>();
  for (const contest of contests) {
    if (contest.respondsToRecordId === null) continue;
    const standing = contestsByRecord.get(contest.respondsToRecordId) ?? [];
    standing.push({
      id: contest.id,
      valueText: contest.valueText,
      createdBy:
        contest.createdById && contest.createdByName
          ? { id: contest.createdById, name: contest.createdByName }
          : null,
    });
    contestsByRecord.set(contest.respondsToRecordId, standing);
  }
  const data = page.flatMap((r) => {
    const item = itemById.get(r.record_id);
    const actor = actorById.get(r.actor_id);
    if (!item || !actor) return [];
    return [
      {
        ...item,
        latestDispute: {
          id: r.annotation_id,
          actor,
          note: r.note,
          createdAt: new Date(r.created_at).toISOString(),
        },
        contestedBy: contestsByRecord.get(r.record_id) ?? [],
      },
    ];
  });
  return { data, nextCursor };
}
