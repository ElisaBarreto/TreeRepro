import { randomBytes } from 'node:crypto';
import type {
  AnnotationKind,
  HarmonisationStatus,
  ImportBatchKind,
  NameSource,
  NameType,
  RecordIntent,
  TraitValueType,
} from '@treerepro/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../src/db/client.ts';
import { recordAnnotations } from '../../src/db/schema/curation.ts';
import { traitCategories, traitLevels, traits } from '../../src/db/schema/dictionary.ts';
import { importBatches } from '../../src/db/schema/imports.ts';
import { plotSpecies, plots, userPlots } from '../../src/db/schema/plots.ts';
import { traitRecords } from '../../src/db/schema/records.ts';
import { bibliographicReferences } from '../../src/db/schema/references.ts';
import { families, genera, species, speciesNames } from '../../src/db/schema/taxa.ts';
import { users } from '../../src/db/schema/users.ts';

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
    names?: {
      name: string;
      nameType?: NameType;
      language?: string;
      source?: string;
      gbifUsageKey?: string;
    }[];
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
        nameType: n.nameType ?? 'gbif',
        language: n.language ?? null,
        source: n.source ?? 'gbif',
        gbifUsageKey: n.gbifUsageKey ?? null,
      })),
    );
  }
  return row;
}

export async function createReference(
  db: DbExecutor,
  options: { citationKey?: string; title?: string; doi?: string } = {},
) {
  const [row] = await db
    .insert(bibliographicReferences)
    .values({
      citationKey: options.citationKey ?? `Test_et_al_${suffix()}`,
      title: options.title,
      doi: options.doi,
    })
    .returning({
      id: bibliographicReferences.id,
      citationKey: bibliographicReferences.citationKey,
      doi: bibliographicReferences.doi,
    });
  if (!row) throw new Error('createReference: no row');
  return row;
}

export async function createImportBatch(
  db: DbExecutor,
  options: { fileName?: string; kind?: ImportBatchKind } = {},
) {
  const [row] = await db
    .insert(importBatches)
    .values({
      fileName: options.fileName ?? `test-${suffix()}.csv`,
      fileSha256: randomBytes(32).toString('hex'),
      kind: options.kind ?? 'records',
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
  minValue?: number;
  maxValue?: number;
  meanValue?: number;
  sdValue?: number;
  n?: number;
  harmonisation?: HarmonisationStatus;
  rawValue?: string;
  primaryReferenceId?: string | null;
  secondaryReferenceId?: string | null;
  supersedesRecordId?: string;
  /** Overrides the default `now()` (RFC-71 R1's day bounds need fixed instants). */
  createdAt?: Date;
};
type RecordOrigin =
  | { origin?: 'import'; importBatchId: string; importRowNo?: number }
  | {
      origin: 'manual';
      createdBy: string;
      note?: string;
      /** A response record (RFC-70 R1); both fields go together. */
      intent?: RecordIntent;
      respondsToRecordId?: string;
    };

let rowCounter = 0;

/** Inserts one record; `harmonisation` defaults to `harmonised` when a level or one of single/min/max/mean is given, else `unknown_level`. */
export async function createRecord(db: DbExecutor, input: RecordBase & RecordOrigin) {
  const quantitative = [input.numericValue, input.minValue, input.maxValue, input.meanValue];
  const harmonisation =
    input.harmonisation ??
    (input.levelId !== undefined || quantitative.some((v) => v !== undefined)
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
      minValue: input.minValue ?? null,
      maxValue: input.maxValue ?? null,
      meanValue: input.meanValue ?? null,
      sdValue: input.sdValue ?? null,
      n: input.n ?? null,
      harmonisation,
      rawValue: input.rawValue ?? null,
      primaryReferenceId: input.primaryReferenceId ?? null,
      secondaryReferenceId: input.secondaryReferenceId ?? null,
      supersedesRecordId: input.supersedesRecordId ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.origin === 'manual'
        ? {
            origin: 'manual' as const,
            createdBy: input.createdBy,
            note: input.note ?? null,
            intent: input.intent ?? null,
            respondsToRecordId: input.respondsToRecordId ?? null,
          }
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

/**
 * A trait category of its own, for tests that must know every trait in a
 * category: the seeded categories hold the shared dictionary and gain traits
 * whenever a sibling test file calls `createTrait` without a category.
 *
 * `sortOrder` defaults far behind the seeded categories (which are numbered by
 * their line in `seed/trait-dictionary.csv`), because the dictionary is
 * ordered by it and sibling test files read the head of that list.
 */
export async function createTraitCategory(
  db: DbExecutor,
  options: { key?: string; label?: string; sortOrder?: number } = {},
): Promise<{ key: string; label: string }> {
  const key = options.key ?? `test_category_${suffix()}`;
  const [row] = await db
    .insert(traitCategories)
    .values({
      key,
      label: options.label ?? `Test category ${key}`,
      sortOrder: options.sortOrder ?? 10_000,
    })
    .returning({ key: traitCategories.key, label: traitCategories.label });
  if (!row) throw new Error('createTraitCategory: no row');
  return row;
}

/**
 * A trait of its own for tests that edit the dictionary or read the global
 * queues: seeded traits are shared by every test file and must stay untouched.
 */
export async function createTrait(
  db: DbExecutor,
  options: {
    key?: string;
    valueType?: TraitValueType;
    unit?: string | null;
    categoryKey?: string;
    levels?: string[];
    active?: boolean;
  } = {},
): Promise<{
  id: string;
  key: string;
  valueType: TraitValueType;
  unit: string | null;
  levels: { id: string; key: string }[];
}> {
  const valueType = options.valueType ?? 'categorical';
  const categoryKey =
    options.categoryKey ??
    (await db.select({ key: traitCategories.key }).from(traitCategories).limit(1))[0]?.key;
  if (!categoryKey) throw new Error('createTrait: no trait category (is the dictionary seeded?)');
  const [trait] = await db
    .insert(traits)
    .values({
      key: options.key ?? `test_trait_${suffix()}`,
      categoryKey,
      valueType,
      unit: options.unit ?? (valueType === 'quantitative' ? 'mm' : null),
      active: options.active ?? true,
    })
    .returning({ id: traits.id, key: traits.key, valueType: traits.valueType, unit: traits.unit });
  if (!trait) throw new Error('createTrait: no row');
  const levelKeys = options.levels ?? (valueType === 'categorical' ? ['alpha', 'beta'] : []);
  const levels =
    levelKeys.length === 0
      ? []
      : await db
          .insert(traitLevels)
          .values(levelKeys.map((key, i) => ({ traitId: trait.id, key, sortOrder: i })))
          .returning({ id: traitLevels.id, key: traitLevels.key });
  return { ...trait, levels };
}

export async function createAnnotation(
  db: DbExecutor,
  input: {
    recordId: string;
    actorId: string;
    kind: AnnotationKind;
    note?: string;
    referenceId?: string;
    generated?: boolean;
    /** Overrides the default `now()`; the digest counts annotations over a window (RFC-74 R3). */
    createdAt?: Date;
  },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(recordAnnotations)
    .values({
      recordId: input.recordId,
      actorId: input.actorId,
      kind: input.kind,
      note: input.note ?? null,
      referenceId: input.referenceId ?? null,
      generated: input.generated ?? false,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning({ id: recordAnnotations.id });
  if (!row) throw new Error('createAnnotation: no row');
  return row;
}

/**
 * RFC-33 R9 fixture: an inactive species with a record on an active trait, and
 * an active species with a record on an inactive trait. Both records are
 * invisible to a restricted viewer; `visible` is a control record.
 */
export async function createVisibilityFixture(db: DbExecutor, actorId: string) {
  const reference = await createReference(db);
  const activeTrait = await createTrait(db, { levels: ['one'] });
  const inactiveTrait = await createTrait(db, { levels: ['one'], active: false });
  const hiddenSpecies = await createSpecies(db);
  await db.update(species).set({ active: false }).where(eq(species.id, hiddenSpecies.id));
  const shownSpecies = await createSpecies(db);
  const level = (t: { levels: { id: string; key: string }[] }) => t.levels[0]?.id as string;
  const onHiddenSpecies = await createRecord(db, {
    speciesId: hiddenSpecies.id,
    traitId: activeTrait.id,
    valueText: 'one',
    levelId: level(activeTrait),
    primaryReferenceId: reference.id,
    origin: 'manual',
    createdBy: actorId,
  });
  const onInactiveTrait = await createRecord(db, {
    speciesId: shownSpecies.id,
    traitId: inactiveTrait.id,
    valueText: 'one',
    levelId: level(inactiveTrait),
    primaryReferenceId: reference.id,
    origin: 'manual',
    createdBy: actorId,
  });
  const visible = await createRecord(db, {
    speciesId: shownSpecies.id,
    traitId: activeTrait.id,
    valueText: 'one',
    levelId: level(activeTrait),
    primaryReferenceId: reference.id,
    origin: 'manual',
    createdBy: actorId,
  });
  return {
    reference,
    activeTrait,
    inactiveTrait,
    hiddenSpecies,
    shownSpecies,
    onHiddenSpecies,
    onInactiveTrait,
    visible,
  };
}

export async function createPlot(
  db: DbExecutor,
  options: { code?: string; name?: string } = {},
): Promise<{ id: string; code: string; name: string }> {
  const code = options.code ?? `Plot-${suffix()}`;
  const name = options.name ?? `Field Plot ${code}`;
  const [row] = await db
    .insert(plots)
    .values({ code, name })
    .returning({ id: plots.id, code: plots.code, name: plots.name });
  if (!row) throw new Error('createPlot: no row');
  return row;
}

export async function addPlotSpecies(
  db: DbExecutor,
  plotId: string,
  speciesIds: string[],
): Promise<void> {
  if (speciesIds.length === 0) return;
  await db.insert(plotSpecies).values(
    speciesIds.map((speciesId) => ({
      plotId,
      speciesId,
    })),
  );
}

export async function assignPlots(
  db: DbExecutor,
  userId: string,
  plotIds: string[],
  restricted = false,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userPlots).where(eq(userPlots.userId, userId));
    if (plotIds.length > 0) {
      await tx.insert(userPlots).values(
        plotIds.map((plotId) => ({
          userId,
          plotId,
        })),
      );
    }
    await tx.update(users).set({ restrictToAssignedPlots: restricted }).where(eq(users.id, userId));
  });
}
