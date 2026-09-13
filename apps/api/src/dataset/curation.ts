import type {
  AcceptedDecision,
  AcceptedState,
  AnnotationKind,
  RecordDetail,
  RecordValue,
  TraitValueType,
} from '@treerepro/contracts';
import { and, desc, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { acceptedValues, recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import { AppError } from '../http/errors.ts';
import { isHarmonisableNumber } from './import.ts';
import { getRecord, reviewStatusSql } from './records.ts';

const validation = (path: string, message: string) =>
  new AppError('VALIDATION_FAILED', 'Request validation failed', [{ path, message }]);

export interface TraitBrief {
  id: string;
  key: string;
  valueType: TraitValueType;
  unit: string | null;
  active: boolean;
}

/** @rfc RFC-65 R1 */
export async function requireTrait(db: DbExecutor, traitId: string): Promise<TraitBrief> {
  const [row] = await db
    .select({
      id: traits.id,
      key: traits.key,
      valueType: traits.valueType,
      unit: traits.unit,
      active: traits.active,
    })
    .from(traits)
    .where(eq(traits.id, traitId))
    .limit(1);
  if (!row) throw new AppError('TRAIT_NOT_FOUND', 'Trait not found');
  return row;
}

/** @rfc RFC-65 R1 */
export async function requireSpecies(db: DbExecutor, speciesId: string): Promise<{ id: string }> {
  const [row] = await db
    .select({ id: species.id })
    .from(species)
    .where(eq(species.id, speciesId))
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
  | { levelId: string; levelKey: string; numericValue: null }
  | { levelId: null; levelKey: null; numericValue: number };

/**
 * A manual value against its trait: the level must belong to the trait and be
 * active; the number must pass the RFC-64 R6 rule. `path` prefixes the detail
 * paths (`value` for a record, `value` for a mapping).
 * @rfc RFC-65 R1, R9
 */
export async function resolveValue(
  db: DbExecutor,
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
      .where(and(eq(traitLevels.id, value.levelId), eq(traitLevels.traitId, trait.id)))
      .limit(1);
    if (!level) throw validation(`${path}.levelId`, 'Level does not belong to this trait');
    if (!level.active) throw validation(`${path}.levelId`, 'Level is inactive');
    return { levelId: level.id, levelKey: level.key, numericValue: null };
  }
  if (trait.valueType !== 'quantitative')
    throw validation(path, 'A categorical trait takes a level');
  if (!isHarmonisableNumber(String(value.numeric)))
    throw validation(`${path}.numeric`, 'Number is out of range');
  return { levelId: null, levelKey: null, numericValue: value.numeric };
}

/** The canonical text of a number, as PostgreSQL prints `numeric` (`1e3` → `1000`). @rfc RFC-65 R1 */
export function numericText(n: number): SQL<string> {
  return sql<string>`(${String(n)}::numeric)::text`;
}

export interface CreateRecordInput {
  actorId: string;
  speciesId: string;
  traitId: string;
  value: RecordValue;
  primaryReferenceId: string;
  secondaryReferenceId?: string;
  rawValue?: string;
  note?: string;
}

/**
 * One manual, harmonised claim. A single INSERT: on a claim-key collision the
 * existing record is looked up afterwards (nothing is left aborted) and named
 * in the 409.
 * @rfc RFC-65 R1, R2
 */
export async function createRecord(
  db: DbExecutor,
  input: CreateRecordInput,
): Promise<RecordDetail> {
  await requireSpecies(db, input.speciesId);
  const trait = await requireTrait(db, input.traitId);
  if (!trait.active) throw validation('traitId', 'Trait is inactive');
  await requireReference(db, input.primaryReferenceId, 'primaryReferenceId');
  if (input.secondaryReferenceId !== undefined)
    await requireReference(db, input.secondaryReferenceId, 'secondaryReferenceId');
  const value = await resolveValue(db, trait, input.value);
  const valueText: string | SQL<string> =
    value.levelKey !== null ? value.levelKey : numericText(value.numericValue);
  const claim = {
    speciesId: input.speciesId,
    traitId: input.traitId,
    rawValue: input.rawValue ?? null,
    primaryReferenceId: input.primaryReferenceId,
    secondaryReferenceId: input.secondaryReferenceId ?? null,
  };
  let inserted: { id: string } | undefined;
  try {
    [inserted] = await db
      .insert(traitRecords)
      .values({
        ...claim,
        levelId: value.levelId,
        numericValue: value.numericValue,
        valueText,
        harmonisation: 'harmonised',
        origin: 'manual',
        createdBy: input.actorId,
        note: input.note ?? null,
      })
      .returning({ id: traitRecords.id });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [existing] = await db
      .select({ id: traitRecords.id })
      .from(traitRecords)
      .where(
        and(
          eq(traitRecords.speciesId, claim.speciesId),
          eq(traitRecords.traitId, claim.traitId),
          eq(traitRecords.valueText, valueText),
          claim.rawValue === null
            ? isNull(traitRecords.rawValue)
            : eq(traitRecords.rawValue, claim.rawValue),
          eq(traitRecords.primaryReferenceId, claim.primaryReferenceId),
          claim.secondaryReferenceId === null
            ? isNull(traitRecords.secondaryReferenceId)
            : eq(traitRecords.secondaryReferenceId, claim.secondaryReferenceId),
        ),
      )
      .limit(1);
    throw new AppError(
      'RECORD_DUPLICATE',
      'This claim already exists; confirm it instead',
      existing ? [{ path: 'recordId', message: existing.id }] : undefined,
    );
  }
  if (!inserted) throw new Error('createRecord: insert returned no row');
  const detail = await getRecord(db, inserted.id);
  if (!detail) throw new Error('createRecord: record vanished');
  return detail;
}

/** The newest accepted-value decision of a species and trait, or null. @rfc RFC-65 R4, R6 */
export async function currentAccepted(
  db: DbExecutor,
  speciesId: string,
  traitId: string,
): Promise<{ decision: AcceptedDecision; recordId: string | null } | null> {
  const [row] = await db
    .select({ decision: acceptedValues.decision, recordId: acceptedValues.recordId })
    .from(acceptedValues)
    .where(and(eq(acceptedValues.speciesId, speciesId), eq(acceptedValues.traitId, traitId)))
    .orderBy(desc(acceptedValues.id))
    .limit(1);
  return row ?? null;
}

export interface AnnotateRecordInput {
  recordId: string;
  actorId: string;
  kind: AnnotationKind;
  note?: string;
  /** The actor holds `records.withdraw` (RFC-65 R4). */
  canWithdrawAny: boolean;
}

/** @rfc RFC-65 R3, R4 */
export async function annotateRecord(
  db: DbExecutor,
  input: AnnotateRecordInput,
): Promise<RecordDetail> {
  const [rec] = await db
    .select({
      id: traitRecords.id,
      origin: traitRecords.origin,
      createdBy: traitRecords.createdBy,
      speciesId: traitRecords.speciesId,
      traitId: traitRecords.traitId,
      // A bare Column here renders unqualified ("id" instead of
      // "trait_records"."id") because this SELECT has a single FROM table;
      // reviewStatusSql then embeds it inside a subquery over
      // record_annotations, where unqualified "id" resolves to that table's
      // own id column instead. Wrapping it as an SQL fragment forces correct
      // qualification.
      review: reviewStatusSql(sql`${traitRecords.id}`).as('review'),
    })
    .from(traitRecords)
    .where(eq(traitRecords.id, input.recordId))
    .limit(1);
  if (!rec) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
  if (rec.review === 'withdrawn')
    throw new AppError('RECORD_WITHDRAWN', 'This record is withdrawn');
  if (input.kind === 'withdraw') {
    if (rec.origin !== 'manual')
      throw new AppError('RECORD_NOT_WITHDRAWABLE', 'Only manual records can be withdrawn');
    if (rec.createdBy !== input.actorId && !input.canWithdrawAny)
      throw new AppError('PERMISSION_DENIED', 'Only the author may withdraw this record');
    const current = await currentAccepted(db, rec.speciesId, rec.traitId);
    if (current?.decision === 'accepted' && current.recordId === rec.id)
      throw new AppError(
        'RECORD_IS_ACCEPTED',
        'This record is the accepted value; change the accepted value first',
      );
  }
  await db.insert(recordAnnotations).values({
    recordId: rec.id,
    actorId: input.actorId,
    kind: input.kind,
    note: input.note ?? null,
  });
  const detail = await getRecord(db, rec.id);
  if (!detail) throw new Error('annotateRecord: record vanished');
  return detail;
}

/** @rfc RFC-65 R6, R11 */
export async function getAccepted(
  db: DbExecutor,
  speciesId: string,
  traitId: string,
): Promise<AcceptedState> {
  const rows = await db
    .select({
      id: acceptedValues.id,
      decision: acceptedValues.decision,
      recordId: acceptedValues.recordId,
      note: acceptedValues.note,
      createdAt: acceptedValues.createdAt,
      actorId: users.id,
      actorName: users.name,
      valueText: traitRecords.valueText,
    })
    .from(acceptedValues)
    .innerJoin(users, eq(users.id, acceptedValues.actorId))
    .leftJoin(traitRecords, eq(traitRecords.id, acceptedValues.recordId))
    .where(and(eq(acceptedValues.speciesId, speciesId), eq(acceptedValues.traitId, traitId)))
    .orderBy(desc(acceptedValues.id));
  const history = rows.map((r) => ({
    id: r.id,
    decision: r.decision,
    recordId: r.recordId,
    valueText: r.valueText ?? null,
    actor: { id: r.actorId, name: r.actorName },
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
  const newest = rows[0];
  const current =
    newest && newest.decision === 'accepted' && newest.recordId && newest.valueText !== null
      ? {
          id: newest.id,
          recordId: newest.recordId,
          valueText: newest.valueText,
          actor: { id: newest.actorId, name: newest.actorName },
          note: newest.note,
          decidedAt: newest.createdAt.toISOString(),
        }
      : null;
  return { current, history };
}

export interface SetAcceptedInput {
  speciesId: string;
  traitId: string;
  actorId: string;
  decision: AcceptedDecision;
  recordId?: string;
  note?: string;
}

/** Idempotent: a request equal to the current state inserts nothing. @rfc RFC-65 R6 */
export async function setAccepted(db: DbExecutor, input: SetAcceptedInput): Promise<AcceptedState> {
  await requireSpecies(db, input.speciesId);
  await requireTrait(db, input.traitId);
  const current = await currentAccepted(db, input.speciesId, input.traitId);
  if (input.decision === 'accepted') {
    const recordId = input.recordId;
    if (!recordId) throw validation('recordId', 'Required');
    const [rec] = await db
      .select({
        id: traitRecords.id,
        speciesId: traitRecords.speciesId,
        traitId: traitRecords.traitId,
        harmonisation: traitRecords.harmonisation,
        // See the comment in annotateRecord: this SELECT has a single FROM
        // table, so a bare Column here would render unqualified and break
        // reviewStatusSql's nested subquery.
        review: reviewStatusSql(sql`${traitRecords.id}`).as('review'),
      })
      .from(traitRecords)
      .where(eq(traitRecords.id, recordId))
      .limit(1);
    if (!rec) throw new AppError('RECORD_NOT_FOUND', 'Record not found');
    if (rec.speciesId !== input.speciesId || rec.traitId !== input.traitId)
      throw validation('recordId', 'Record belongs to another species or trait');
    if (rec.harmonisation !== 'harmonised')
      throw new AppError('RECORD_NOT_HARMONISED', 'Only a harmonised record can be accepted');
    if (rec.review === 'withdrawn')
      throw new AppError('RECORD_WITHDRAWN', 'This record is withdrawn');
    if (!(current?.decision === 'accepted' && current.recordId === recordId)) {
      await db.insert(acceptedValues).values({
        speciesId: input.speciesId,
        traitId: input.traitId,
        recordId,
        decision: 'accepted',
        actorId: input.actorId,
        note: input.note ?? null,
      });
    }
  } else if (current && current.decision === 'accepted') {
    await db.insert(acceptedValues).values({
      speciesId: input.speciesId,
      traitId: input.traitId,
      recordId: null,
      decision: 'cleared',
      actorId: input.actorId,
      note: input.note ?? null,
    });
  }
  return getAccepted(db, input.speciesId, input.traitId);
}
