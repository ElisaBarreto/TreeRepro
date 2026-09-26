import type {
  CreateRecordsResult as ContractCreateRecordsResult,
  QuantitativeValue,
  RecordCodeRef,
  RecordDetail,
  RecordIntent,
  RecordOrigin,
  RecordValue,
} from '@treerepro/contracts';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import {
  levelVisible,
  speciesVisible,
  traitVisible,
  type Visibility,
} from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { contestLevels, contestRecords, contests } from '../db/schema/contests.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { recordReferences, traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import { requireTrait, type TraitBrief } from './dictionary.ts';
import { isHarmonisableNumber } from './import.ts';
import { getRecord, itemQuery, recordVisible, toItem } from './records.ts';

const validation = (path: string, message: string) =>
  new AppError('VALIDATION_FAILED', 'Request validation failed', [{ path, message }]);

// `requireTrait` and `TraitBrief` moved to `dictionary.ts` (an import cycle:
// `catalog.ts` imports `taxa.ts`, which now needs `requireTrait`); they are
// re-exported here so every existing caller keeps its import.
export { requireTrait, type TraitBrief };

/**
 * @rfc RFC-65 R1
 * @rfc RFC-33 R2, R4
 */
export async function requireSpecies(
  db: DbExecutor,
  visibility: Visibility,
  speciesId: string,
): Promise<{ id: string }> {
  const [row] = await db
    .select({ id: species.id })
    .from(species)
    .where(and(eq(species.id, speciesId), speciesVisible(visibility)))
    .limit(1);
  if (!row) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
  return row;
}

async function requireReference(db: DbExecutor, id: string, path: string): Promise<void> {
  const [row] = await db
    .select({ id: bibliographicReferences.id })
    .from(bibliographicReferences)
    .where(eq(bibliographicReferences.id, id))
    .limit(1);
  if (!row)
    throw new AppError('REFERENCE_NOT_FOUND', 'Reference not found', [
      { path, message: 'Reference not found' },
    ]);
}

export type ResolvedValue =
  | { levelId: string; levelKey: string; quantitative: null }
  | { levelId: null; levelKey: null; quantitative: QuantitativeValue };

/**
 * One level against its trait: it belongs to the trait, is visible to
 * `visibility`, and is active. `path` is the exact detail path
 * (`value.levelIds.2` for a record, `value.levelId` for a mapping).
 * @rfc RFC-65 R1, R9
 * @rfc RFC-33 R2, R5
 */
export async function resolveLevel(
  db: DbExecutor,
  visibility: Visibility,
  trait: Pick<TraitBrief, 'id' | 'valueType'>,
  levelId: string,
  path: string,
): Promise<{ levelId: string; levelKey: string }> {
  if (trait.valueType !== 'categorical')
    throw validation('value', 'A quantitative trait takes a number');
  const [level] = await db
    .select({ id: traitLevels.id, key: traitLevels.key, active: traitLevels.active })
    .from(traitLevels)
    .where(
      and(eq(traitLevels.id, levelId), eq(traitLevels.traitId, trait.id), levelVisible(visibility)),
    )
    .limit(1);
  if (!level) throw validation(path, 'Level does not belong to this trait');
  if (!level.active) throw validation(path, 'Level is inactive');
  return { levelId: level.id, levelKey: level.key };
}

/** One value of one record: a level, or a quantitative value. @rfc RFC-65 R1, R9 */
export type SingleValue = { levelId: string } | Exclude<RecordValue, { levelIds: string[] }>;

/**
 * One manual value against its trait: a level per {@link resolveLevel}, or a
 * number that passes the RFC-64 R6 rule. `path` prefixes the detail paths.
 * @rfc RFC-65 R1, R9
 * @rfc RFC-33 R2, R5
 */
export async function resolveValue(
  db: DbExecutor,
  visibility: Visibility,
  trait: Pick<TraitBrief, 'id' | 'valueType'>,
  value: SingleValue,
  path = 'value',
): Promise<ResolvedValue> {
  if ('levelId' in value) {
    const level = await resolveLevel(db, visibility, trait, value.levelId, `${path}.levelId`);
    return { ...level, quantitative: null };
  }
  if (trait.valueType !== 'quantitative')
    throw validation(path, 'A categorical trait takes a level');
  const q = value.quantitative;
  for (const key of ['single', 'min', 'max', 'mean', 'sd'] as const) {
    const n = q[key];
    if (n !== undefined && !isHarmonisableNumber(String(n)))
      throw validation(`${path}.quantitative.${key}`, 'Number is out of range');
  }
  return { levelId: null, levelKey: null, quantitative: q };
}

/**
 * The `value_text` of a quantitative claim (RFC-63 R15): the single value as
 * PostgreSQL prints `numeric` (`1e3` → `1000`) when it is the only field;
 * otherwise every given field as `<name>=<value>`, `;`-joined in the order
 * single, min, max, mean, sd, n — so claims differing in any of the six
 * fields differ in the claim key (RFC-63 R3).
 * @rfc RFC-63 R3, R15
 * @rfc RFC-65 R1
 */
export function quantitativeText(q: QuantitativeValue): SQL<string> {
  const num = (v: number) => sql<string>`(${String(v)}::numeric)::text`;
  const fields = [
    ['single', q.single],
    ['min', q.min],
    ['max', q.max],
    ['mean', q.mean],
    ['sd', q.sd],
    ['n', q.n],
  ] as const;
  const given = fields.filter(([, v]) => v !== undefined) as [string, number][];
  const [only] = given;
  if (given.length === 1 && only?.[0] === 'single') return num(only[1]);
  return sql<string>`concat_ws(';', ${sql.join(
    given.map(([name, v]) => sql`${`${name}=`}::text || ${num(v)}`),
    sql`, `,
  )})`;
}

/**
 * The record codes of one entry (RFC-63 R12): one `record_code_tr_seq`
 * number, bare for a single record (`TR_5`) and lettered for several
 * (`TR_7a`, `TR_7b`, …, `record_code_suffix` of migration 0035). A lone
 * insert may rely on the column default instead; a form that creates several
 * records (plan 13g) names the codes this returns.
 * @rfc RFC-63 R12
 */
export async function nextRecordCodes(db: DbExecutor, count: number): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('nextRecordCodes: count must be a positive integer');
  }
  // The FROM subquery holds a volatile call, so PostgreSQL evaluates it once:
  // every code of the entry shares one number.
  const rows = (await db.execute(sql`
    select 'TR_' || s.v || case when ${count}::int = 1 then '' else record_code_suffix(g) end as code
    from (select nextval('record_code_tr_seq') as v) s
    cross join generate_series(1, ${count}::int) g
    order by g`)) as unknown as { code: string }[];
  return rows.map((r) => r.code);
}

export interface CreateRecordsInput {
  actorId: string;
  speciesId: string;
  traitId: string;
  value: RecordValue;
  referenceIds: string[];
  intent?: RecordIntent;
  respondsToRecordId?: string;
  contestedLevelIds?: string[];
  rawValue?: string;
  note?: string;
  secondaryReferenceId?: string;
}

/** @rfc RFC-70 R3 */
export type CreateRecordsResult = ContractCreateRecordsResult;

/**
 * RFC-70 R1's combination rule, once the trait's value type is known: no
 * intent takes neither `respondsToRecordId` nor `contestedLevelIds`; a
 * complement, and a contest on a quantitative trait, take
 * `respondsToRecordId` alone; a contest on a categorical trait takes
 * `contestedLevelIds` alone.
 */
function intentCombinationValid(input: CreateRecordsInput, categorical: boolean): boolean {
  const responds = input.respondsToRecordId !== undefined;
  const contested = input.contestedLevelIds !== undefined;
  if (input.intent === undefined) return !responds && !contested;
  if (input.intent === 'contest' && categorical) return contested && !responds;
  return responds && !contested;
}

/**
 * Adds the actor's confirms on one record, each only once (RFC-65 R3): one
 * per supporting reference not yet given, or — with no supporting reference
 * (a personal observation) — a single reference-less confirm when the actor
 * has not confirmed the record at all.
 */
async function confirmOnce(
  tx: DbExecutor,
  recordId: string,
  actorId: string,
  referenceIds: string[],
): Promise<void> {
  const existing = await tx
    .select({ referenceId: recordAnnotations.referenceId })
    .from(recordAnnotations)
    .where(
      and(
        eq(recordAnnotations.recordId, recordId),
        eq(recordAnnotations.actorId, actorId),
        eq(recordAnnotations.kind, 'confirm'),
      ),
    );
  const given = new Set(existing.map((row) => row.referenceId));
  const missing: (string | null)[] =
    referenceIds.length === 0
      ? existing.length === 0
        ? [null]
        : []
      : referenceIds.filter((id) => !given.has(id));
  if (missing.length === 0) return;
  await tx
    .insert(recordAnnotations)
    .values(
      missing.map((referenceId) => ({ recordId, actorId, kind: 'confirm' as const, referenceId })),
    );
}

interface CodeRow {
  id: string;
  record_code: string;
  created_by: string | null;
}

/**
 * The records an entry matches (RFC-70 R3): the visible records of the
 * species × trait on the same level, or — quantitative — with the six fields
 * all identical (`is not distinct from`, so an absent field matches only an
 * absent one).
 */
async function matchingRecords(
  tx: DbExecutor,
  visibility: Visibility,
  input: CreateRecordsInput,
  value: ResolvedValue,
): Promise<CodeRow[]> {
  const q = value.quantitative;
  const num = (v: number | undefined) => (v === undefined ? sql`null` : sql`${String(v)}::numeric`);
  const same =
    q === null
      ? sql`r.level_id = ${value.levelId}::uuid`
      : sql`r.level_id is null
          and r.numeric_value is not distinct from ${num(q.single)}
          and r.min_value is not distinct from ${num(q.min)}
          and r.max_value is not distinct from ${num(q.max)}
          and r.mean_value is not distinct from ${num(q.mean)}
          and r.sd_value is not distinct from ${num(q.sd)}
          and r.n is not distinct from ${q.n ?? null}::int`;
  return (await tx.execute(sql`
    select r.id, r.record_code, r.created_by from trait_records r
    where r.species_id = ${input.speciesId}::uuid and r.trait_id = ${input.traitId}::uuid
      and ${same} and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}
    order by r.id`)) as unknown as CodeRow[];
}

/**
 * E of RFC-63 R14: the active levels of the trait with a record of the
 * species visible to the actor, read under the species × trait lock.
 */
async function levelsWithVisibleRecords(
  tx: DbExecutor,
  visibility: Visibility,
  input: CreateRecordsInput,
): Promise<Set<string>> {
  const rows = (await tx.execute(sql`
    select distinct l.id from trait_levels l
    join trait_records r on r.level_id = l.id
    where l.trait_id = ${input.traitId}::uuid and l.active
      and r.species_id = ${input.speciesId}::uuid and r.trait_id = ${input.traitId}::uuid
      and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}`)) as unknown as {
    id: string;
  }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * `POST /api/records` (RFC-70 R3). One record per level, or one quantitative
 * record. Everything that reads state runs in one transaction after the
 * species × trait lock (E3), so a concurrent withdrawal or entry cannot slip
 * between a read and the write it decides:
 * - the responded record must be visible (404) and of the same species and
 *   trait (400); a quantitative contest must differ from it (RFC-70 R2);
 * - a categorical contest computes E and S, and refuses an empty E \ S (400
 *   path `intent`) or a `contestedLevelIds` other than E \ S (400 path
 *   `contestedLevelIds`) before writing anything;
 * - each entry that matches visible records validates every one the actor
 *   did not create and reports the actor's own as duplicates (RFC-65 R13);
 * - the rest are inserted under one code number (RFC-63 R12); a claim-key
 *   collision creates nothing and is a duplicate only when the colliding
 *   record is visible (RFC-33 R4);
 * - a contest is stored with the levels it contests and the records it
 *   created, even none (RFC-63 R14) — except a quantitative contest whose
 *   value matched, which contests nothing.
 * @rfc RFC-70 R1, R2, R3
 * @rfc RFC-65 R1
 * @rfc RFC-63 R3, R12, R14, R16
 * @rfc RFC-33 R2, R4, R5
 */
export async function createRecords(
  db: DbExecutor,
  visibility: Visibility,
  input: CreateRecordsInput,
): Promise<CreateRecordsResult> {
  await requireSpecies(db, visibility, input.speciesId);
  const trait = await requireTrait(db, visibility, input.traitId);
  if (!trait.active) throw validation('traitId', 'Trait is inactive');
  const categorical = trait.valueType === 'categorical';
  if (!intentCombinationValid(input, categorical)) {
    throw validation(
      'intent',
      categorical
        ? 'A contest names contestedLevelIds; a complement names respondsToRecordId'
        : 'A contest or a complement names respondsToRecordId',
    );
  }
  const values: ResolvedValue[] = [];
  if ('levelIds' in input.value) {
    for (const [i, levelId] of input.value.levelIds.entries()) {
      values.push({
        ...(await resolveLevel(db, visibility, trait, levelId, `value.levelIds.${i}`)),
        quantitative: null,
      });
    }
  } else {
    values.push(await resolveValue(db, visibility, trait, input.value));
  }
  if (input.secondaryReferenceId !== undefined) {
    await requireReference(db, input.secondaryReferenceId, 'secondaryReferenceId');
  }
  const [primaryReferenceId, ...moreReferenceIds] = input.referenceIds;
  if (primaryReferenceId === undefined) throw validation('sources', 'A reference is required');
  // `record_references` counts a reference's usage once per record (RFC-61
  // R4, R9): a reference already recorded as the primary or the secondary,
  // or repeated among the extras, would otherwise be double-counted — or, for
  // a repeat, hit the table's primary key. Kept in first-occurrence order.
  const seenReferenceIds = new Set<string>([primaryReferenceId]);
  if (input.secondaryReferenceId !== undefined) seenReferenceIds.add(input.secondaryReferenceId);
  const extraReferenceIds = moreReferenceIds.filter((referenceId) => {
    if (seenReferenceIds.has(referenceId)) return false;
    seenReferenceIds.add(referenceId);
    return true;
  });
  const isContest = input.intent === 'contest';

  return db.transaction(async (tx) => {
    await lockSpeciesTrait(tx, input.speciesId, input.traitId);

    if (input.respondsToRecordId !== undefined) {
      const [target] = await tx
        .select({
          speciesId: traitRecords.speciesId,
          traitId: traitRecords.traitId,
          numericValue: traitRecords.numericValue,
          minValue: traitRecords.minValue,
          maxValue: traitRecords.maxValue,
          meanValue: traitRecords.meanValue,
          sdValue: traitRecords.sdValue,
          n: traitRecords.n,
        })
        .from(traitRecords)
        .innerJoin(species, eq(species.id, traitRecords.speciesId))
        .innerJoin(traits, eq(traits.id, traitRecords.traitId))
        .where(
          and(
            eq(traitRecords.id, input.respondsToRecordId),
            speciesVisible(visibility),
            traitVisible(visibility),
            recordVisible(visibility),
          ),
        )
        .limit(1);
      if (!target) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
      if (target.speciesId !== input.speciesId || target.traitId !== input.traitId) {
        throw validation(
          'respondsToRecordId',
          'A response must share the species and trait of the record it responds to',
        );
      }
      const q = values[0]?.quantitative;
      if (isContest && q) {
        const same = (a: number | undefined, b: number | null) => (a ?? null) === b;
        if (
          same(q.single, target.numericValue) &&
          same(q.min, target.minValue) &&
          same(q.max, target.maxValue) &&
          same(q.mean, target.meanValue) &&
          same(q.sd, target.sdValue) &&
          same(q.n, target.n)
        ) {
          throw validation('value', 'A contest carries a different value');
        }
      }
    }

    // A categorical contest: E \ S are the levels it contests (RFC-63 R14).
    let contestedLevelIds: string[] = [];
    if (isContest && categorical) {
      const e = await levelsWithVisibleRecords(tx, visibility, input);
      const s = new Set(values.map((v) => v.levelId));
      contestedLevelIds = [...e].filter((id) => !s.has(id));
      if (contestedLevelIds.length === 0) {
        throw validation(
          'intent',
          'A contest must contest at least one level; this is a complement',
        );
      }
      const stated = new Set(input.contestedLevelIds);
      if (
        stated.size !== contestedLevelIds.length ||
        contestedLevelIds.some((id) => !stated.has(id))
      ) {
        throw validation('contestedLevelIds', 'The contested levels changed; reload them');
      }
    }

    const kinds = await tx
      .select({ kind: bibliographicReferences.kind })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, primaryReferenceId));
    // A personal observation is no supporting reference: its validation
    // carries none (RFC-70 R3). Every distinct source supports it — the
    // secondary included, which `extraReferenceIds` leaves out.
    const supporting =
      kinds[0]?.kind === 'personal_observation' ? [] : [...new Set(input.referenceIds)];

    const validated: RecordCodeRef[] = [];
    const duplicates: RecordCodeRef[] = [];
    const toCreate: ResolvedValue[] = [];
    for (const value of values) {
      const matches = await matchingRecords(tx, visibility, input, value);
      if (matches.length === 0) {
        toCreate.push(value);
        continue;
      }
      for (const match of matches) {
        const ref = { recordId: match.id, recordCode: match.record_code };
        if (match.created_by === input.actorId) {
          duplicates.push(ref);
        } else {
          await confirmOnce(tx, match.id, input.actorId, supporting);
          validated.push(ref);
        }
      }
    }

    // One sequence number for the records actually created; a collision
    // below leaves a gap, which RFC-63 R12 accepts.
    const codes = toCreate.length === 0 ? [] : await nextRecordCodes(tx, toCreate.length);
    const createdIds: string[] = [];
    for (const [i, value] of toCreate.entries()) {
      const valueText: string | SQL<string> =
        value.levelKey !== null ? value.levelKey : quantitativeText(value.quantitative);
      const [row] = await tx
        .insert(traitRecords)
        .values({
          recordCode: codes[i] as string,
          speciesId: input.speciesId,
          traitId: input.traitId,
          valueText,
          levelId: value.levelId,
          numericValue: value.quantitative?.single ?? null,
          minValue: value.quantitative?.min ?? null,
          maxValue: value.quantitative?.max ?? null,
          meanValue: value.quantitative?.mean ?? null,
          sdValue: value.quantitative?.sd ?? null,
          n: value.quantitative?.n ?? null,
          harmonisation: 'harmonised',
          rawValue: input.rawValue ?? null,
          primaryReferenceId,
          secondaryReferenceId: input.secondaryReferenceId ?? null,
          origin: 'manual',
          createdBy: input.actorId,
          note: input.note ?? null,
          intent: input.intent ?? null,
          respondsToRecordId: input.respondsToRecordId ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: traitRecords.id });
      if (row) {
        createdIds.push(row.id);
        if (extraReferenceIds.length > 0) {
          await tx
            .insert(recordReferences)
            .values(extraReferenceIds.map((referenceId) => ({ recordId: row.id, referenceId })));
        }
        continue;
      }
      // The claim key (RFC-63 R3) already holds this claim: named only when
      // the colliding record is visible to the actor (RFC-33 R4).
      const [colliding] = (await tx.execute(sql`
        select r.id, r.record_code, r.created_by from trait_records r
        where r.species_id = ${input.speciesId}::uuid and r.trait_id = ${input.traitId}::uuid
          and r.value_text = ${valueText}
          and r.raw_value is not distinct from ${input.rawValue ?? null}::text
          and r.primary_reference_id = ${primaryReferenceId}::uuid
          and r.secondary_reference_id is not distinct from ${input.secondaryReferenceId ?? null}::uuid
          and ${recordVisible(visibility, sql`r.id`, sql`r.harmonisation`)}`)) as unknown as CodeRow[];
      if (colliding) duplicates.push({ recordId: colliding.id, recordCode: colliding.record_code });
    }

    // A quantitative contest that matched or collided contests nothing.
    if (isContest && (categorical || createdIds.length > 0)) {
      const [contest] = await tx
        .insert(contests)
        .values({ speciesId: input.speciesId, traitId: input.traitId, createdBy: input.actorId })
        .returning({ id: contests.id });
      if (!contest) throw new Error('createRecords: no contest row');
      if (contestedLevelIds.length > 0) {
        await tx
          .insert(contestLevels)
          .values(contestedLevelIds.map((levelId) => ({ contestId: contest.id, levelId })));
      }
      if (createdIds.length > 0) {
        await tx
          .insert(contestRecords)
          .values(createdIds.map((recordId) => ({ contestId: contest.id, recordId })));
      }
    }

    const rows =
      createdIds.length === 0
        ? []
        : await itemQuery(tx, visibility).where(inArray(traitRecords.id, createdIds));
    const byId = new Map(rows.map((r) => [r.record.id, toItem(r)]));
    const created = createdIds.map((id) => {
      const item = byId.get(id);
      if (!item) throw new Error('createRecords: created record vanished');
      return item;
    });
    return { created, validated, duplicates };
  });
}

export interface AnnotateRecordInput {
  recordId: string;
  actorId: string;
  kind: 'confirm' | 'withdraw';
  referenceId?: string;
  /** `records.withdraw`: any manual record (spec R-12). */
  canWithdrawAny: boolean;
  /** `records.withdraw_imported`: any imported record (spec R-12). */
  canWithdrawImported: boolean;
}

/**
 * Who may withdraw a record (spec R-12): its author, else `records.withdraw`
 * for a manual record and `records.withdraw_imported` for an imported one.
 * @rfc RFC-65 R4
 */
export function mayWithdraw(
  rec: { origin: RecordOrigin; createdBy: string | null },
  who: { actorId: string; canWithdrawAny: boolean; canWithdrawImported: boolean },
): boolean {
  if (rec.createdBy === who.actorId) return true;
  return rec.origin === 'manual' ? who.canWithdrawAny : who.canWithdrawImported;
}

/**
 * The one lock every write that reads or changes contested state takes,
 * before any read it decides on: the create path, record withdraw, the
 * level actions and the two contest actions all key on the species × trait
 * pair, so they serialise against each other rather than against unrelated
 * records of the same species or trait.
 * @rfc RFC-70 R3
 */
export async function lockSpeciesTrait(
  tx: DbExecutor,
  speciesId: string,
  traitId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${speciesId}:${traitId}`}, 0))`,
  );
}

/**
 * One annotation. The species × trait lock (E3) is taken first, from a bare
 * by-id lookup, before the visibility/liveness read that decides 404 and
 * before either kind's check-then-insert — so two concurrent calls on the
 * same record serialise rather than race: the second sees the first's write
 * (a `withdraw` makes the record invisible, `recordVisible`) instead of both
 * reading a live record and one of them hitting
 * `record_annotations_withdraw_idx` as a raw unique-violation. `confirm` is a
 * validation, refused on the actor's own record (R-6); a confirm the actor
 * already gave with the same reference, or a reference-less confirm when
 * they already confirmed the record, inserts nothing and answers the same
 * detail as the first — a confirm with a new reference is inserted (RFC-65
 * R3). `withdraw` answers `null`: a withdrawn record is visible to no viewer
 * (RFC-33 R2), so there is no detail left to answer with. `neutral`,
 * `dispute` and `resolve` never reach here — the route refuses them before
 * this is called (RFC-65 R3; Keep both moves to the contest routes, Task 7).
 * @rfc RFC-70 R3, R4
 * @rfc RFC-65 R3, R4
 * @rfc RFC-33 R2, R5
 */
export async function annotateRecord(
  db: DbExecutor,
  visibility: Visibility,
  input: AnnotateRecordInput,
): Promise<RecordDetail | null> {
  return db.transaction(async (tx) => {
    // The species × trait pair is looked up by id alone, before any
    // visibility or liveness check, purely to take the lock (E3) — an
    // unknown id still answers 404 here, the same code and message the
    // visibility-checked read below would give it. Locking first and only
    // then reading visibility/liveness means two concurrent annotations of
    // the same record serialise: the second sees the first's write (a
    // `withdraw` makes the record invisible, `recordVisible`) instead of
    // racing it to an insert and hitting `record_annotations_withdraw_idx`
    // as a raw 23505.
    const [ids] = await tx
      .select({ speciesId: traitRecords.speciesId, traitId: traitRecords.traitId })
      .from(traitRecords)
      .where(eq(traitRecords.id, input.recordId))
      .limit(1);
    if (!ids) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
    await lockSpeciesTrait(tx, ids.speciesId, ids.traitId);

    const [rec] = await tx
      .select({
        id: traitRecords.id,
        origin: traitRecords.origin,
        createdBy: traitRecords.createdBy,
        speciesId: traitRecords.speciesId,
        traitId: traitRecords.traitId,
      })
      .from(traitRecords)
      .innerJoin(species, eq(species.id, traitRecords.speciesId))
      .innerJoin(traits, eq(traits.id, traitRecords.traitId))
      .where(
        and(
          eq(traitRecords.id, input.recordId),
          speciesVisible(visibility),
          traitVisible(visibility),
          recordVisible(visibility),
        ),
      )
      .limit(1);
    // `recordVisible` already excludes a withdrawn record (it is live-only),
    // a non-harmonised one for a non-reviewer, and one on an inactive level
    // for a viewer without `dataset.read_inactive` (RFC-33 R2) — so an
    // invisible or withdrawn record answers 404 here, never a stale
    // `RECORD_WITHDRAWN` (RFC-65 R3, RFC-33 R5, ruling E6, E12). Taken under
    // the lock, this is also the check a concurrent withdrawal cannot slip
    // past: it either committed before this select (record now invisible,
    // 404) or blocks on the lock until this transaction ends.
    if (!rec) throw new AppError('RECORD_NOT_FOUND', 'Record not found');

    if (input.kind === 'confirm') {
      if (rec.createdBy === input.actorId) {
        throw new AppError('PERMISSION_DENIED', 'You cannot validate your own record');
      }
      await confirmOnce(tx, rec.id, input.actorId, input.referenceId ? [input.referenceId] : []);
      return getRecord(tx, visibility, rec.id);
    }

    // `withdraw`: already serialised by the species × trait lock taken
    // above, ahead of the level and contest actions that will share it
    // (Task 7).
    if (!mayWithdraw(rec, input)) {
      throw new AppError('PERMISSION_DENIED', 'You may not withdraw this record');
    }
    await tx.insert(recordAnnotations).values({
      recordId: rec.id,
      actorId: input.actorId,
      kind: 'withdraw',
    });
    // The record is now invisible to every viewer (RFC-33 R2): there is no
    // detail left to answer with.
    return null;
  });
}

/** A visible record of one level, with what `mayWithdraw` needs. */
interface LevelRecord {
  recordId: string;
  recordCode: string;
  origin: RecordOrigin;
  createdBy: string | null;
}

interface LevelInput {
  speciesId: string;
  traitId: string;
  levelId: string;
  actorId: string;
}

/**
 * The checks the two level actions share, under the species × trait lock:
 * species and trait visible (404), the level the trait's and visible (400
 * path `levelId`, RFC-33 R5), and at least one visible record of it for the
 * species (404 `RECORD_NOT_FOUND`).
 */
async function levelRecords(
  tx: DbExecutor,
  visibility: Visibility,
  input: LevelInput,
): Promise<LevelRecord[]> {
  await lockSpeciesTrait(tx, input.speciesId, input.traitId);
  await requireSpecies(tx, visibility, input.speciesId);
  await requireTrait(tx, visibility, input.traitId);
  const [level] = await tx
    .select({ id: traitLevels.id })
    .from(traitLevels)
    .where(
      and(
        eq(traitLevels.id, input.levelId),
        eq(traitLevels.traitId, input.traitId),
        levelVisible(visibility),
      ),
    )
    .limit(1);
  if (!level) throw validation('levelId', 'Level does not belong to this trait');
  const rows = await tx
    .select({
      recordId: traitRecords.id,
      recordCode: traitRecords.recordCode,
      origin: traitRecords.origin,
      createdBy: traitRecords.createdBy,
    })
    .from(traitRecords)
    .where(
      and(
        eq(traitRecords.speciesId, input.speciesId),
        eq(traitRecords.traitId, input.traitId),
        eq(traitRecords.levelId, input.levelId),
        recordVisible(visibility),
      ),
    )
    .orderBy(traitRecords.id);
  if (rows.length === 0) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
  return rows;
}

const codeRef = (r: LevelRecord): RecordCodeRef => ({
  recordId: r.recordId,
  recordCode: r.recordCode,
});

/**
 * Validate a level: one `confirm` on every visible record of the species ×
 * trait × level that the actor did not create and has not yet validated.
 * 403 when every visible record is the actor's own. `validated` lists the
 * records newly validated, empty when all already were.
 * @rfc RFC-65 R13
 * @rfc RFC-70 R4
 * @rfc RFC-33 R5
 */
export async function validateLevel(
  db: DbExecutor,
  visibility: Visibility,
  input: LevelInput & { referenceId?: string },
): Promise<{ validated: RecordCodeRef[] }> {
  return db.transaction(async (tx) => {
    const others = (await levelRecords(tx, visibility, input)).filter(
      (r) => r.createdBy !== input.actorId,
    );
    if (others.length === 0) {
      throw new AppError('PERMISSION_DENIED', 'You cannot validate your own record');
    }
    const confirmed = await tx
      .selectDistinct({ recordId: recordAnnotations.recordId })
      .from(recordAnnotations)
      .where(
        and(
          eq(recordAnnotations.actorId, input.actorId),
          eq(recordAnnotations.kind, 'confirm'),
          inArray(
            recordAnnotations.recordId,
            others.map((r) => r.recordId),
          ),
        ),
      );
    const already = new Set(confirmed.map((c) => c.recordId));
    const todo = others.filter((r) => !already.has(r.recordId));
    for (const r of todo) {
      await confirmOnce(
        tx,
        r.recordId,
        input.actorId,
        input.referenceId ? [input.referenceId] : [],
      );
    }
    return { validated: todo.map(codeRef) };
  });
}

/**
 * Withdraw a level: a `withdraw` on every visible record of the species ×
 * trait × level the actor may withdraw (`mayWithdraw`); `remaining` lists the
 * visible records they may not, which keep the level contested.
 * @rfc RFC-65 R4, R14
 * @rfc RFC-33 R5
 */
export async function withdrawLevel(
  db: DbExecutor,
  visibility: Visibility,
  input: LevelInput & { canWithdrawAny: boolean; canWithdrawImported: boolean },
): Promise<{ withdrawn: RecordCodeRef[]; remaining: RecordCodeRef[] }> {
  return db.transaction(async (tx) => {
    const rows = await levelRecords(tx, visibility, input);
    const mine = rows.filter((r) => mayWithdraw(r, input));
    const inserted =
      mine.length === 0
        ? []
        : await tx
            .insert(recordAnnotations)
            .values(
              mine.map((r) => ({
                recordId: r.recordId,
                actorId: input.actorId,
                kind: 'withdraw' as const,
              })),
            )
            .onConflictDoNothing()
            .returning({ recordId: recordAnnotations.recordId });
    const done = new Set(inserted.map((i) => i.recordId));
    return {
      withdrawn: mine.filter((r) => done.has(r.recordId)).map(codeRef),
      remaining: rows.filter((r) => !mayWithdraw(r, input)).map(codeRef),
    };
  });
}
