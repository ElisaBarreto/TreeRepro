import type {
  DisputedRecord,
  MapPendingBody,
  MapResult,
  PendingGroup,
  PendingTrait,
} from '@treerepro/contracts';
import { inArray, type SQL, sql } from 'drizzle-orm';
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
    where ${PENDING}
      and ${traitVisible(visibility, sql`t.active`)}
      and ${speciesVisible(visibility, sql`s.active`)}
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
    where r.trait_id = ${input.traitId} and ${PENDING} and ${speciesVisible(visibility, sql`s.active`)}
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
        from trait_records r where ${group}),
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

/**
 * Standing disputes: per record, the newest annotation among the actors whose
 * latest stance is `dispute`; excluded once withdrawn or once an accepted
 * decision for the species and trait is newer than the dispute. Starts from
 * `record_annotations` (human-scale), never scans `trait_records`. Two steps:
 * the page of dispute rows, then the record items through the shared join and
 * the actors through Drizzle so their names are decrypted (RFC-40).
 * @rfc RFC-65 R10
 * @rfc RFC-33 R2, R3
 */
export async function listDisputed(
  db: DbExecutor,
  visibility: Visibility,
  input: { cursor?: string; limit: number },
): Promise<{ data: DisputedRecord[]; nextCursor: string | null }> {
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = (await db.execute(sql`
    with stances as (
      select distinct on (a.record_id, a.actor_id) a.record_id, a.actor_id, a.id, a.kind, a.note, a.created_at
      from record_annotations a where a.kind <> 'withdraw'
      order by a.record_id, a.actor_id, a.id desc),
    standing as (
      select distinct on (s.record_id) s.record_id, s.id as annotation_id, s.actor_id, s.note, s.created_at
      from stances s where s.kind = 'dispute'
      order by s.record_id, s.id desc)
    select d.record_id, d.annotation_id, d.actor_id, d.note, d.created_at
    from standing d
    join trait_records r on r.id = d.record_id
    join species sp on sp.id = r.species_id
    join traits tr on tr.id = r.trait_id
    where not exists (select 1 from record_annotations w where w.record_id = d.record_id and w.kind = 'withdraw')
      and not exists (select 1 from accepted_values v
        where v.species_id = r.species_id and v.trait_id = r.trait_id and v.created_at > d.created_at)
      and (${after}::uuid is null or d.annotation_id < ${after}::uuid)
      and ${speciesVisible(visibility, sql`sp.active`)}
      and ${traitVisible(visibility, sql`tr.active`)}
    order by d.annotation_id desc
    limit ${input.limit + 1}`)) as unknown as DisputeRow[];
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.annotation_id));
  if (page.length === 0) return { data: [], nextCursor };
  const [items, actors] = await Promise.all([
    itemQuery(db).where(
      inArray(
        traitRecords.id,
        page.map((r) => r.record_id),
      ),
    ),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(page.map((r) => r.actor_id))])),
  ]);
  const itemById = new Map(items.map((i) => [i.record.id, toItem(i)]));
  const actorById = new Map(actors.map((a) => [a.id, a]));
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
      },
    ];
  });
  return { data, nextCursor };
}
