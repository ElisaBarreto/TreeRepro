import { randomBytes } from 'node:crypto';
import type { HarmonisationStatus, NameSource, TraitValueType } from '@treerepro/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../src/db/client.ts';
import { traitLevels, traits } from '../../src/db/schema/dictionary.ts';
import { importBatches } from '../../src/db/schema/imports.ts';
import { traitRecords } from '../../src/db/schema/records.ts';
import { bibliographicReferences } from '../../src/db/schema/references.ts';
import { families, genera, species, speciesNames } from '../../src/db/schema/taxa.ts';

const suffix = () => randomBytes(4).toString('hex');

/** Names are random so parallel test files never collide on the unique indexes. */
export async function createFamily(db: DbExecutor, options: { name?: string } = {}) {
  const [row] = await db
    .insert(families)
    .values({ name: options.name ?? `Testaceae-${suffix()}` })
    .returning({ id: families.id, name: families.name });
  if (!row) throw new Error('createFamily: no row');
  return row;
}

export async function createGenus(
  db: DbExecutor,
  options: { name?: string; familyId?: string | null } = {},
) {
  const [row] = await db
    .insert(genera)
    .values({ name: options.name ?? `Testus-${suffix()}`, familyId: options.familyId ?? null })
    .returning({ id: genera.id, name: genera.name });
  if (!row) throw new Error('createGenus: no row');
  return row;
}

export async function createSpecies(
  db: DbExecutor,
  options: {
    canonicalName?: string;
    nameSource?: NameSource;
    genusId?: string | null;
    names?: { name: string; gbifUsageKey?: string }[];
  } = {},
) {
  const [row] = await db
    .insert(species)
    .values({
      canonicalName: options.canonicalName ?? `Testus specimen-${suffix()}`,
      nameSource: options.nameSource ?? 'wcvp',
      genusId: options.genusId ?? null,
    })
    .returning({ id: species.id, canonicalName: species.canonicalName });
  if (!row) throw new Error('createSpecies: no row');
  if (options.names?.length) {
    await db.insert(speciesNames).values(
      options.names.map((n) => ({
        speciesId: row.id,
        name: n.name,
        gbifUsageKey: n.gbifUsageKey ?? null,
      })),
    );
  }
  return row;
}

export async function createReference(
  db: DbExecutor,
  options: { citationKey?: string; title?: string } = {},
) {
  const [row] = await db
    .insert(bibliographicReferences)
    .values({ citationKey: options.citationKey ?? `Test_et_al_${suffix()}`, title: options.title })
    .returning({
      id: bibliographicReferences.id,
      citationKey: bibliographicReferences.citationKey,
    });
  if (!row) throw new Error('createReference: no row');
  return row;
}

export async function createImportBatch(db: DbExecutor, options: { fileName?: string } = {}) {
  const [row] = await db
    .insert(importBatches)
    .values({
      fileName: options.fileName ?? `test-${suffix()}.csv`,
      fileSha256: randomBytes(32).toString('hex'),
      status: 'completed',
      finishedAt: new Date(),
    })
    .returning({ id: importBatches.id });
  if (!row) throw new Error('createImportBatch: no row');
  return row;
}

/** A trait of the seeded dictionary (test/global-setup.ts seeds it). */
export async function traitByKey(
  db: DbExecutor,
  key: string,
): Promise<{ id: string; key: string; valueType: TraitValueType; unit: string | null }> {
  const [row] = await db
    .select({ id: traits.id, key: traits.key, valueType: traits.valueType, unit: traits.unit })
    .from(traits)
    .where(eq(traits.key, key));
  if (!row) throw new Error(`traitByKey: ${key} is not in the dictionary (is it seeded?)`);
  return row;
}

export async function levelByKey(
  db: DbExecutor,
  traitId: string,
  key: string,
): Promise<{ id: string; key: string }> {
  const [row] = await db
    .select({ id: traitLevels.id, key: traitLevels.key })
    .from(traitLevels)
    .where(
      and(eq(traitLevels.traitId, traitId), eq(sql`lower(${traitLevels.key})`, key.toLowerCase())),
    );
  if (!row) throw new Error(`levelByKey: ${key} is not a level of ${traitId}`);
  return row;
}

type RecordBase = {
  speciesId: string;
  traitId: string;
  valueText: string;
  levelId?: string;
  numericValue?: number;
  harmonisation?: HarmonisationStatus;
  rawValue?: string;
  primaryReferenceId?: string | null;
  secondaryReferenceId?: string | null;
};
type RecordOrigin =
  | { origin?: 'import'; importBatchId: string; importRowNo?: number }
  | { origin: 'manual'; createdBy: string; note?: string };

let rowCounter = 0;

/** Inserts one record; `harmonisation` defaults to `harmonised` when a level or number is given, else `unknown_level`. */
export async function createRecord(db: DbExecutor, input: RecordBase & RecordOrigin) {
  const harmonisation =
    input.harmonisation ??
    (input.levelId !== undefined || input.numericValue !== undefined
      ? 'harmonised'
      : 'unknown_level');
  const [row] = await db
    .insert(traitRecords)
    .values({
      speciesId: input.speciesId,
      traitId: input.traitId,
      valueText: input.valueText,
      levelId: input.levelId ?? null,
      numericValue: input.numericValue ?? null,
      harmonisation,
      rawValue: input.rawValue ?? null,
      primaryReferenceId: input.primaryReferenceId ?? null,
      secondaryReferenceId: input.secondaryReferenceId ?? null,
      ...(input.origin === 'manual'
        ? { origin: 'manual' as const, createdBy: input.createdBy, note: input.note ?? null }
        : {
            origin: 'import' as const,
            importBatchId: input.importBatchId,
            importRowNo: input.importRowNo ?? ++rowCounter,
          }),
    })
    .returning({ id: traitRecords.id });
  if (!row) throw new Error('createRecord: no row');
  return row;
}
