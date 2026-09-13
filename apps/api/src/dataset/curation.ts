import type { RecordDetail, RecordValue, TraitValueType } from '@treerepro/contracts';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import { isHarmonisableNumber } from './import.ts';
import { getRecord } from './records.ts';

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
