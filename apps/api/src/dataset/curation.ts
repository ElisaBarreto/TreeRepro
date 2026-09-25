import type {
  QuantitativeValue,
  RecordDetail,
  RecordIntent,
  RecordOrigin,
  RecordValue,
} from '@treerepro/contracts';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import {
  levelVisible,
  speciesVisible,
  traitVisible,
  UNRESTRICTED,
  type Visibility,
} from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { recordReferences, traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import { requireTrait, type TraitBrief } from './dictionary.ts';
import { isHarmonisableNumber } from './import.ts';
import { getRecord, liveSql, recordVisible } from './records.ts';

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
 * A manual value against its trait: the level must belong to the trait,
 * be visible to `visibility` and be active; the number must pass the RFC-64
 * R6 rule. `path` prefixes the detail paths (`value` for a record, `value`
 * for a mapping).
 * @rfc RFC-65 R1, R9
 * @rfc RFC-33 R2, R5
 */
export async function resolveValue(
  db: DbExecutor,
  visibility: Visibility,
  trait: Pick<TraitBrief, 'id' | 'valueType'>,
  value: RecordValue,
  path = 'value',
): Promise<ResolvedValue> {
  if ('levelId' in value) {
    if (trait.valueType !== 'categorical')
      throw validation(path, 'A quantitative trait takes a number');
    const [level] = await db
      .select({ id: traitLevels.id, key: traitLevels.key, active: traitLevels.active })
      .from(traitLevels)
      .where(
        and(
          eq(traitLevels.id, value.levelId),
          eq(traitLevels.traitId, trait.id),
          levelVisible(visibility),
        ),
      )
      .limit(1);
    if (!level) throw validation(`${path}.levelId`, 'Level does not belong to this trait');
    if (!level.active) throw validation(`${path}.levelId`, 'Level is inactive');
    return { levelId: level.id, levelKey: level.key, quantitative: null };
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

// `createRecords`'s own use of a generated dispute annotation (RFC-70 R3, R5)
// is Task 6's copy to update (plan 13g E2, E7): left as is here.
/** The note of the dispute a contest generates on the record it answers. @rfc RFC-70 R3 */
export const CONTEST_NOTE = (ids: string[]) => `Contested by record ${ids.join(', ')}`;

export interface CreateRecordsInput {
  actorId: string;
  speciesId: string;
  traitId: string;
  value: RecordValue;
  referenceIds: string[];
  intent?: RecordIntent;
  respondsToRecordId?: string;
  rawValue?: string;
  note?: string;
  secondaryReferenceId?: string;
}

export interface CreateRecordsResult {
  created: RecordDetail[];
  duplicates: { recordId: string; referenceId: string }[];
}

/**
 * One record per value (spec R-4): the first reference is the primary one,
 * the others go to `record_references`. An identical claim (the RFC-63 R3 key,
 * which names the primary reference only) creates nothing and answers 409.
 * `duplicates` stays empty until plan 13g turns a match into a validation.
 * @rfc RFC-70 R2, R3
 * @rfc RFC-63 R3, R16
 */
export async function createRecords(
  db: DbExecutor,
  visibility: Visibility,
  input: CreateRecordsInput,
): Promise<CreateRecordsResult> {
  await requireSpecies(db, visibility, input.speciesId);
  const trait = await requireTrait(db, visibility, input.traitId);
  if (!trait.active) throw validation('traitId', 'Trait is inactive');
  if (input.secondaryReferenceId !== undefined) {
    await requireReference(db, input.secondaryReferenceId, 'secondaryReferenceId');
  }
  const value = await resolveValue(db, visibility, trait, input.value);

  if (input.respondsToRecordId) {
    const [target] = await db
      .select({
        id: traitRecords.id,
        speciesId: traitRecords.speciesId,
        traitId: traitRecords.traitId,
        levelId: traitRecords.levelId,
        numericValue: traitRecords.numericValue,
        live: sql<boolean>`${liveSql(traitRecords.id)}`.as('live'),
      })
      .from(traitRecords)
      .innerJoin(species, eq(species.id, traitRecords.speciesId))
      .innerJoin(traits, eq(traits.id, traitRecords.traitId))
      .where(
        and(
          eq(traitRecords.id, input.respondsToRecordId),
          speciesVisible(visibility),
          traitVisible(visibility),
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
    if (!target.live) {
      throw new AppError('RECORD_WITHDRAWN', 'This record is withdrawn');
    }
    if (input.intent === 'contest') {
      const sameValue =
        (value.levelId !== null && value.levelId === target.levelId) ||
        (value.quantitative?.single !== undefined &&
          target.numericValue !== null &&
          Number(value.quantitative.single) === Number(target.numericValue));
      if (sameValue) {
        throw validation('value', 'A contest carries a different value');
      }
    }
  }

  const valueText: string | SQL<string> =
    value.levelKey !== null ? value.levelKey : quantitativeText(value.quantitative);
  const [primaryReferenceId, ...moreReferenceIds] = input.referenceIds;
  if (primaryReferenceId === undefined) throw validation('sources', 'A reference is required');
  // `record_references` counts a reference's usage once per record (RFC-61
  // R4, R9): a reference already recorded as the primary or the secondary
  // role, or repeated among the extras, would otherwise be double-counted —
  // or, for a repeat, hit the table's primary key as a 500. Kept in first-
  // occurrence order.
  const seenReferenceIds = new Set<string>([primaryReferenceId]);
  if (input.secondaryReferenceId !== undefined) seenReferenceIds.add(input.secondaryReferenceId);
  const extraReferenceIds = moreReferenceIds.filter((referenceId) => {
    if (seenReferenceIds.has(referenceId)) return false;
    seenReferenceIds.add(referenceId);
    return true;
  });

  return db.transaction(async (tx) => {
    if (input.intent === 'contest' && input.respondsToRecordId) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.respondsToRecordId}, 0))`,
      );
    }

    const [inserted] = await tx
      .insert(traitRecords)
      .values({
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

    if (!inserted) {
      const [existing] = await tx
        .select({ id: traitRecords.id })
        .from(traitRecords)
        .where(
          and(
            eq(traitRecords.speciesId, input.speciesId),
            eq(traitRecords.traitId, input.traitId),
            eq(traitRecords.valueText, valueText),
            input.rawValue == null
              ? isNull(traitRecords.rawValue)
              : eq(traitRecords.rawValue, input.rawValue),
            eq(traitRecords.primaryReferenceId, primaryReferenceId),
            input.secondaryReferenceId == null
              ? isNull(traitRecords.secondaryReferenceId)
              : eq(traitRecords.secondaryReferenceId, input.secondaryReferenceId),
          ),
        )
        .limit(1);
      throw new AppError('RECORD_DUPLICATE', 'This claim already exists; confirm it instead', [
        { path: 'sources.references.0', message: existing?.id ?? '' },
      ]);
    }

    if (extraReferenceIds.length > 0) {
      await tx
        .insert(recordReferences)
        .values(extraReferenceIds.map((referenceId) => ({ recordId: inserted.id, referenceId })));
    }

    if (input.intent === 'contest' && input.respondsToRecordId) {
      await tx.insert(recordAnnotations).values({
        recordId: input.respondsToRecordId,
        actorId: input.actorId,
        kind: 'dispute',
        note: CONTEST_NOTE([inserted.id]),
        generated: true,
      });
    }

    const detail = await getRecord(tx, UNRESTRICTED, inserted.id);
    if (!detail) throw new Error('createRecords: record vanished');
    return { created: [detail], duplicates: [] };
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
      const existing = await tx
        .select({ referenceId: recordAnnotations.referenceId })
        .from(recordAnnotations)
        .where(
          and(
            eq(recordAnnotations.recordId, rec.id),
            eq(recordAnnotations.actorId, input.actorId),
            eq(recordAnnotations.kind, 'confirm'),
          ),
        );
      const duplicate =
        input.referenceId === undefined
          ? existing.length > 0
          : existing.some((row) => row.referenceId === input.referenceId);
      if (!duplicate) {
        await tx.insert(recordAnnotations).values({
          recordId: rec.id,
          actorId: input.actorId,
          kind: 'confirm',
          referenceId: input.referenceId ?? null,
        });
      }
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
