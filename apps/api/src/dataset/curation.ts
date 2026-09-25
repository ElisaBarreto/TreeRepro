import type {
  AnnotationKind,
  QuantitativeValue,
  RecordDetail,
  RecordIntent,
  RecordValue,
} from '@treerepro/contracts';
import { and, desc, eq, isNull, type SQL, sql } from 'drizzle-orm';
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
import { getRecord, reviewStatusSql } from './records.ts';

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

/** The note of the dispute a contest generates on the record it answers. @rfc RFC-70 R3 */
export const CONTEST_NOTE = (ids: string[]) => `Contested by record ${ids.join(', ')}`;

/** The note of the neutral that a withdrawn contest leaves behind. @rfc RFC-70 R5 */
export const CONTEST_WITHDRAWN_NOTE = (id: string) => `Contest withdrawn (record ${id})`;

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
        review: reviewStatusSql(traitRecords.id).as('review'),
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
    if (target.review === 'withdrawn') {
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
  kind: AnnotationKind;
  note?: string;
  referenceId?: string;
  /** The actor holds `records.withdraw` (RFC-65 R4). */
  canWithdrawAny: boolean;
  /** The actor holds `records.review` (RFC-70 R4). */
  canReview: boolean;
}

/**
 * `treerepro_app` has no `UPDATE` on `trait_records`, so `SELECT … FOR
 * UPDATE` cannot serialise two annotations of the same record — two
 * withdrawals racing past the `withdrawn` check, say. `pg_advisory_xact_lock`,
 * keyed on the record id and held for the whole transaction, does instead.
 * @rfc RFC-65 R3, R4
 * @rfc RFC-70 R4, R5
 * @rfc RFC-33 R2, R5
 */
export async function annotateRecord(
  db: DbExecutor,
  visibility: Visibility,
  input: AnnotateRecordInput,
): Promise<RecordDetail> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.recordId}, 0))`);
    const [rec] = await tx
      .select({
        id: traitRecords.id,
        origin: traitRecords.origin,
        createdBy: traitRecords.createdBy,
        speciesId: traitRecords.speciesId,
        traitId: traitRecords.traitId,
        intent: traitRecords.intent,
        respondsToRecordId: traitRecords.respondsToRecordId,
        review: reviewStatusSql(traitRecords.id).as('review'),
      })
      .from(traitRecords)
      .innerJoin(species, eq(species.id, traitRecords.speciesId))
      .innerJoin(traits, eq(traits.id, traitRecords.traitId))
      .where(
        and(
          eq(traitRecords.id, input.recordId),
          speciesVisible(visibility),
          traitVisible(visibility),
        ),
      )
      .limit(1);
    if (!rec) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
    if (rec.review === 'withdrawn')
      throw new AppError('RECORD_WITHDRAWN', 'This record is withdrawn');

    if ((input.kind === 'dispute' || input.kind === 'neutral') && !input.canReview) {
      throw new AppError('PERMISSION_DENIED', 'You do not have permission to review records');
    }

    if (input.kind === 'withdraw') {
      if (rec.origin !== 'manual')
        throw new AppError('RECORD_NOT_WITHDRAWABLE', 'Only manual records can be withdrawn');
      if (rec.createdBy !== input.actorId && !input.canWithdrawAny)
        throw new AppError('PERMISSION_DENIED', 'Only the author may withdraw this record');
    }
    await tx.insert(recordAnnotations).values({
      recordId: rec.id,
      actorId: input.actorId,
      kind: input.kind,
      note: input.note ?? null,
      referenceId: input.referenceId ?? null,
    });

    if (input.kind === 'withdraw' && rec.intent === 'contest' && rec.respondsToRecordId) {
      const [base] = await tx
        .select({
          id: traitRecords.id,
          review: reviewStatusSql(traitRecords.id).as('review'),
        })
        .from(traitRecords)
        .where(eq(traitRecords.id, rec.respondsToRecordId))
        .limit(1);
      if (base && base.review !== 'withdrawn') {
        const [latestStance] = await tx
          .select({ kind: recordAnnotations.kind })
          .from(recordAnnotations)
          .where(
            and(
              eq(recordAnnotations.recordId, rec.respondsToRecordId),
              eq(recordAnnotations.actorId, input.actorId),
              sql`${recordAnnotations.kind} <> 'withdraw'`,
            ),
          )
          .orderBy(desc(recordAnnotations.id))
          .limit(1);
        // Only when this was the actor's last live contest: another contest
        // of theirs on the same record still carries the dispute (RFC-70 R5).
        const [otherContest] = await tx
          .select({ id: traitRecords.id })
          .from(traitRecords)
          .where(
            and(
              eq(traitRecords.respondsToRecordId, rec.respondsToRecordId),
              eq(traitRecords.intent, 'contest'),
              eq(traitRecords.createdBy, input.actorId),
              sql`${traitRecords.id} <> ${rec.id}`,
              sql`${reviewStatusSql(traitRecords.id)} <> 'withdrawn'`,
            ),
          )
          .limit(1);
        if (latestStance?.kind === 'dispute' && !otherContest) {
          await tx.insert(recordAnnotations).values({
            recordId: rec.respondsToRecordId,
            actorId: input.actorId,
            kind: 'neutral',
            note: CONTEST_WITHDRAWN_NOTE(rec.id),
            generated: true,
          });
        }
      }
    }

    const detail = await getRecord(tx, visibility, rec.id);
    if (!detail) throw new Error('annotateRecord: record vanished');
    return detail;
  });
}
