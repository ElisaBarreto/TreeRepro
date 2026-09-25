import {
  type Genus,
  isValidIsbn,
  type NameSource,
  type NameType,
  type ReferenceDetail,
  type Species,
  type TaxonRef,
  type Trait,
  type TraitValueType,
} from '@treerepro/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { UNRESTRICTED } from '../access/visibility.ts';
import { recordAudit } from '../audit/audit.ts';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation, violatedConstraint } from '../db/errors.ts';
import { traitCategories, traitLevels, traits } from '../db/schema/dictionary.ts';
import { bibliographicReferences, type ReferenceRow } from '../db/schema/references.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import { getTrait } from './dictionary.ts';
import { normaliseName } from './names.ts';
import { getReference } from './references.ts';
import { getFamily, getGenus, getSpecies } from './taxa.ts';

type TaxonKind = 'family' | 'genus' | 'species' | 'species_name';

async function requireFamilyRow(db: DbExecutor, id: string) {
  const row = await getFamily(db, id);
  if (!row) throw new AppError('FAMILY_NOT_FOUND', 'Family not found');
  return row;
}

async function requireGenusRow(db: DbExecutor, id: string) {
  const [row] = await db
    .select({ id: genera.id, name: genera.name, familyId: genera.familyId })
    .from(genera)
    .where(eq(genera.id, id))
    .limit(1);
  if (!row) throw new AppError('GENUS_NOT_FOUND', 'Genus not found');
  return row;
}

async function requireSpeciesRow(db: DbExecutor, id: string) {
  const [row] = await db
    .select({
      id: species.id,
      canonicalName: species.canonicalName,
      nameSource: species.nameSource,
      genusId: species.genusId,
      active: species.active,
    })
    .from(species)
    .where(eq(species.id, id))
    .limit(1);
  if (!row) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');
  return row;
}

async function taxaAudit(
  db: DbExecutor,
  actorId: string,
  action: 'taxa.created' | 'taxa.updated',
  targetType: string,
  targetId: string,
  metadata: { kind: TaxonKind; fields?: string[]; speciesId?: string },
): Promise<void> {
  await recordAudit(db, { actorUserId: actorId, action, targetType, targetId, metadata });
}

/** @rfc RFC-60 R9, R10 */
export async function createFamily(
  db: DbExecutor,
  input: { name: string; actorId: string },
): Promise<TaxonRef> {
  const name = normaliseName(input.name);
  return db.transaction(async (tx) => {
    let row: TaxonRef | undefined;
    try {
      [row] = await tx
        .insert(families)
        .values({ name, createdBy: input.actorId })
        .returning({ id: families.id, name: families.name });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('FAMILY_NAME_TAKEN', 'A family with this name already exists');
      throw err;
    }
    if (!row) throw new Error('createFamily: insert returned no row');
    await taxaAudit(tx, input.actorId, 'taxa.created', 'families', row.id, { kind: 'family' });
    return row;
  });
}

/** @rfc RFC-60 R9, R10 */
export async function updateFamily(
  db: DbExecutor,
  input: { id: string; name: string; actorId: string },
): Promise<TaxonRef> {
  const name = normaliseName(input.name);
  return db.transaction(async (tx) => {
    const current = await requireFamilyRow(tx, input.id);
    if (current.name === name) return current;
    try {
      await tx.update(families).set({ name }).where(eq(families.id, input.id));
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('FAMILY_NAME_TAKEN', 'A family with this name already exists');
      throw err;
    }
    await taxaAudit(tx, input.actorId, 'taxa.updated', 'families', input.id, {
      kind: 'family',
      fields: ['name'],
    });
    return { id: input.id, name };
  });
}

/** @rfc RFC-60 R9, R10 */
export async function createGenus(
  db: DbExecutor,
  input: { name: string; familyId?: string; actorId: string },
): Promise<Genus> {
  const name = normaliseName(input.name);
  return db.transaction(async (tx) => {
    if (input.familyId !== undefined) await requireFamilyRow(tx, input.familyId);
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(genera)
        .values({ name, familyId: input.familyId ?? null, createdBy: input.actorId })
        .returning({ id: genera.id });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('GENUS_NAME_TAKEN', 'A genus with this name already exists');
      throw err;
    }
    if (!row) throw new Error('createGenus: insert returned no row');
    await taxaAudit(tx, input.actorId, 'taxa.created', 'genera', row.id, { kind: 'genus' });
    const genus = await getGenus(tx, row.id);
    if (!genus) throw new Error('createGenus: genus vanished');
    return genus;
  });
}

/** `familyId: null` detaches the genus. @rfc RFC-60 R9, R10 */
export async function updateGenus(
  db: DbExecutor,
  input: { id: string; name?: string; familyId?: string | null; actorId: string },
): Promise<Genus> {
  const name = input.name === undefined ? undefined : normaliseName(input.name);
  return db.transaction(async (tx) => {
    const current = await requireGenusRow(tx, input.id);
    const fields: string[] = [];
    const set: { name?: string; familyId?: string | null } = {};
    if (name !== undefined && name !== current.name) {
      fields.push('name');
      set.name = name;
    }
    if (input.familyId !== undefined && input.familyId !== current.familyId) {
      if (input.familyId !== null) await requireFamilyRow(tx, input.familyId);
      fields.push('familyId');
      set.familyId = input.familyId;
    }
    if (fields.length > 0) {
      try {
        await tx.update(genera).set(set).where(eq(genera.id, input.id));
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('GENUS_NAME_TAKEN', 'A genus with this name already exists');
        throw err;
      }
      await taxaAudit(tx, input.actorId, 'taxa.updated', 'genera', input.id, {
        kind: 'genus',
        fields,
      });
    }
    const genus = await getGenus(tx, input.id);
    if (!genus) throw new Error('updateGenus: genus vanished');
    return genus;
  });
}

/** @rfc RFC-60 R9, R10 */
export async function createSpecies(
  db: DbExecutor,
  input: { canonicalName: string; nameSource: NameSource; genusId?: string; actorId: string },
): Promise<Species> {
  const canonicalName = normaliseName(input.canonicalName);
  return db.transaction(async (tx) => {
    if (input.genusId !== undefined) await requireGenusRow(tx, input.genusId);
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(species)
        .values({
          canonicalName,
          nameSource: input.nameSource,
          genusId: input.genusId ?? null,
          createdBy: input.actorId,
        })
        .returning({ id: species.id });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError(
          'SPECIES_NAME_TAKEN',
          'A species with this canonical name already exists',
        );
      throw err;
    }
    if (!row) throw new Error('createSpecies: insert returned no row');
    await taxaAudit(tx, input.actorId, 'taxa.created', 'species', row.id, { kind: 'species' });
    const created = await getSpecies(tx, UNRESTRICTED, row.id);
    if (!created) throw new Error('createSpecies: species vanished');
    return created;
  });
}

/** `genusId: null` detaches the species. @rfc RFC-60 R9, R10 */
export async function updateSpecies(
  db: DbExecutor,
  input: {
    id: string;
    canonicalName?: string;
    nameSource?: NameSource;
    genusId?: string | null;
    active?: boolean;
    actorId: string;
  },
): Promise<Species> {
  const canonicalName =
    input.canonicalName === undefined ? undefined : normaliseName(input.canonicalName);
  return db.transaction(async (tx) => {
    const current = await requireSpeciesRow(tx, input.id);
    const fields: string[] = [];
    const set: {
      canonicalName?: string;
      nameSource?: NameSource;
      genusId?: string | null;
      active?: boolean;
    } = {};
    if (canonicalName !== undefined && canonicalName !== current.canonicalName) {
      fields.push('canonicalName');
      set.canonicalName = canonicalName;
    }
    if (input.nameSource !== undefined && input.nameSource !== current.nameSource) {
      fields.push('nameSource');
      set.nameSource = input.nameSource;
    }
    if (input.genusId !== undefined && input.genusId !== current.genusId) {
      if (input.genusId !== null) await requireGenusRow(tx, input.genusId);
      fields.push('genusId');
      set.genusId = input.genusId;
    }
    if (input.active !== undefined && input.active !== current.active) {
      fields.push('active');
      set.active = input.active;
    }
    if (fields.length > 0) {
      try {
        await tx.update(species).set(set).where(eq(species.id, input.id));
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError(
            'SPECIES_NAME_TAKEN',
            'A species with this canonical name already exists',
          );
        throw err;
      }
      await taxaAudit(tx, input.actorId, 'taxa.updated', 'species', input.id, {
        kind: 'species',
        fields,
      });
    }
    const updated = await getSpecies(tx, UNRESTRICTED, input.id);
    if (!updated) throw new Error('updateSpecies: species vanished');
    return updated;
  });
}

/**
 * `source` defaults to `'manual'` when the body omits it, while the column
 * defaults to `'gbif'` for the rows the import writes (RFC-60 R1, R9): the two
 * defaults differ on purpose.
 * @rfc RFC-60 R4, R9, R10
 */
export async function addSpeciesName(
  db: DbExecutor,
  input: {
    speciesId: string;
    name: string;
    nameType: NameType;
    language?: string;
    source?: string;
    gbifUsageKey?: string;
    actorId: string;
  },
): Promise<Species> {
  const name = normaliseName(input.name);
  return db.transaction(async (tx) => {
    const current = await requireSpeciesRow(tx, input.speciesId);
    if (current.canonicalName === name)
      throw new AppError('SPECIES_NAME_TAKEN', 'This is already the canonical name of the species');
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(speciesNames)
        .values({
          speciesId: input.speciesId,
          name,
          nameType: input.nameType,
          language: input.language ?? null,
          source: input.source ?? 'manual',
          gbifUsageKey: input.gbifUsageKey ?? null,
        })
        .returning({ id: speciesNames.id });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('SPECIES_NAME_TAKEN', 'The species already carries this name');
      throw err;
    }
    if (!row) throw new Error('addSpeciesName: insert returned no row');
    await taxaAudit(tx, input.actorId, 'taxa.created', 'species_names', row.id, {
      kind: 'species_name',
      speciesId: input.speciesId,
    });
    const updated = await getSpecies(tx, UNRESTRICTED, input.speciesId);
    if (!updated) throw new Error('addSpeciesName: species vanished');
    return updated;
  });
}

function referenceTaken(err: unknown): never {
  if (isUniqueViolation(err)) {
    const constraint = violatedConstraint(err);
    if (constraint === 'bibliographic_references_doi_idx') {
      throw new AppError('REFERENCE_DOI_TAKEN', 'Another reference has this DOI');
    }
    if (constraint === 'bibliographic_references_isbn_idx') {
      throw new AppError('REFERENCE_ISBN_TAKEN', 'Another reference has this ISBN');
    }
    throw new AppError('REFERENCE_KEY_TAKEN', 'Another reference has this citation key');
  }
  throw err;
}

const referenceInvalid = (path: string, message: string) =>
  new AppError('VALIDATION_FAILED', 'Request validation failed', [{ path, message }]);

// The ISBN as stored: the normalised ISBN-13 (RFC-61 R10).
function normalisedIsbn(isbn: string | undefined): string | undefined {
  if (isbn === undefined) return undefined;
  const normalised = isValidIsbn(isbn);
  if (normalised === null) throw referenceInvalid('isbn', 'Invalid ISBN');
  return normalised;
}

export interface ReferenceFields {
  citationKey?: string;
  title?: string | null;
  authors?: string | null;
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
  url?: string | null;
  isbn?: string;
  shortCitation?: string | null;
  fullCitation?: string | null;
}

const REFERENCE_FIELDS = [
  'citationKey',
  'title',
  'authors',
  'year',
  'journal',
  'doi',
  'url',
  'isbn',
  'shortCitation',
  'fullCitation',
] as const;

/** An ISBN makes the reference a `book`, which needs its full citation. @rfc RFC-61 R6, R10 */
export async function createReference(
  db: DbExecutor,
  input: ReferenceFields & { citationKey: string; actorId: string },
): Promise<ReferenceDetail> {
  const isbn = normalisedIsbn(input.isbn);
  if (isbn !== undefined && input.fullCitation == null) {
    throw referenceInvalid('fullCitation', 'A book needs its citation');
  }
  return db.transaction(async (tx) => {
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(bibliographicReferences)
        .values({
          citationKey: input.citationKey,
          title: input.title ?? null,
          authors: input.authors ?? null,
          year: input.year ?? null,
          journal: input.journal ?? null,
          doi: input.doi ?? null,
          url: input.url ?? null,
          isbn: isbn ?? null,
          kind: isbn === undefined ? 'publication' : 'book',
          shortCitation: input.shortCitation ?? null,
          fullCitation: input.fullCitation ?? null,
          createdBy: input.actorId,
        })
        .returning({ id: bibliographicReferences.id });
    } catch (err) {
      referenceTaken(err);
    }
    if (!row) throw new Error('createReference: insert returned no row');
    await recordAudit(tx, {
      actorUserId: input.actorId,
      action: 'references.created',
      targetType: 'bibliographic_references',
      targetId: row.id,
      metadata: {},
    });
    const created = await getReference(tx, row.id);
    if (!created) throw new Error('createReference: reference vanished');
    return created;
  });
}

/**
 * `null` clears a metadata field; `citationKey` is never null. Only a book
 * takes an ISBN.
 * @rfc RFC-61 R6, R10
 */
export async function updateReference(
  db: DbExecutor,
  raw: ReferenceFields & { id: string; actorId: string },
): Promise<ReferenceDetail> {
  const input = { ...raw, isbn: normalisedIsbn(raw.isbn) };
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, input.id))
      .limit(1);
    if (!current) throw new AppError('REFERENCE_NOT_FOUND', 'Reference not found');
    if (current.kind === 'personal_observation') {
      throw new AppError(
        'REFERENCE_IS_PERSONAL',
        'Personal observation references cannot be edited',
      );
    }
    // A book is recorded under its citation (RFC-61 R10); the check
    // `bibliographic_references_book_check` would refuse the update anyway.
    if (current.kind === 'book' && input.fullCitation === null) {
      throw referenceInvalid('fullCitation', 'A book needs its citation');
    }
    if (current.kind !== 'book' && input.isbn !== undefined) {
      throw referenceInvalid('isbn', 'Only a book has an ISBN');
    }
    const fields: string[] = [];
    const set: Partial<Pick<ReferenceRow, (typeof REFERENCE_FIELDS)[number]>> = {};
    for (const field of REFERENCE_FIELDS) {
      const next = input[field];
      if (next !== undefined && next !== current[field]) {
        fields.push(field);
        (set as Record<string, unknown>)[field] = next;
      }
    }
    if (fields.length > 0) {
      try {
        await tx
          .update(bibliographicReferences)
          .set(set)
          .where(eq(bibliographicReferences.id, input.id));
      } catch (err) {
        referenceTaken(err);
      }
      await recordAudit(tx, {
        actorUserId: input.actorId,
        action: 'references.updated',
        targetType: 'bibliographic_references',
        targetId: input.id,
        metadata: { fields },
      });
    }
    const updated = await getReference(tx, input.id);
    if (!updated) throw new Error('updateReference: reference vanished');
    return updated;
  });
}

async function requireCategory(db: DbExecutor, key: string): Promise<void> {
  const [row] = await db
    .select({ key: traitCategories.key })
    .from(traitCategories)
    .where(eq(traitCategories.key, key))
    .limit(1);
  if (!row)
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path: 'categoryKey', message: 'Unknown category' },
    ]);
}

async function requireTraitRow(db: DbExecutor, id: string) {
  const [row] = await db.select().from(traits).where(eq(traits.id, id)).limit(1);
  if (!row) throw new AppError('TRAIT_NOT_FOUND', 'Trait not found');
  return row;
}

async function traitAudit(
  db: DbExecutor,
  actorId: string,
  action: 'traits.created' | 'traits.updated',
  traitId: string,
  metadata: { fields?: string[]; levelId?: string },
): Promise<void> {
  await recordAudit(db, {
    actorUserId: actorId,
    action,
    targetType: 'traits',
    targetId: traitId,
    metadata,
  });
}

async function traitOrThrow(db: DbExecutor, id: string, where: string): Promise<Trait> {
  const trait = await getTrait(db, UNRESTRICTED, id);
  if (!trait) throw new Error(`${where}: trait vanished`);
  return trait;
}

/** @rfc RFC-62 R6 */
export async function createTrait(
  db: DbExecutor,
  input: {
    key: string;
    categoryKey: string;
    valueType: TraitValueType;
    unit?: string;
    description?: string;
    actorId: string;
  },
): Promise<Trait> {
  return db.transaction(async (tx) => {
    await requireCategory(tx, input.categoryKey);
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(traits)
        .values({
          key: input.key,
          categoryKey: input.categoryKey,
          valueType: input.valueType,
          unit: input.unit ?? null,
          description: input.description ?? '',
          createdBy: input.actorId,
        })
        .returning({ id: traits.id });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('TRAIT_KEY_TAKEN', 'A trait with this key already exists');
      throw err;
    }
    if (!row) throw new Error('createTrait: insert returned no row');
    await traitAudit(tx, input.actorId, 'traits.created', row.id, {});
    return traitOrThrow(tx, row.id, 'createTrait');
  });
}

/** `key`, `valueType` and `unit` are immutable (RFC-62 R6). @rfc RFC-62 R6 */
export async function updateTrait(
  db: DbExecutor,
  input: {
    id: string;
    categoryKey?: string;
    description?: string;
    active?: boolean;
    actorId: string;
  },
): Promise<Trait> {
  return db.transaction(async (tx) => {
    const current = await requireTraitRow(tx, input.id);
    const fields: string[] = [];
    const set: { categoryKey?: string; description?: string; active?: boolean } = {};
    if (input.categoryKey !== undefined && input.categoryKey !== current.categoryKey) {
      await requireCategory(tx, input.categoryKey);
      fields.push('categoryKey');
      set.categoryKey = input.categoryKey;
    }
    if (input.description !== undefined && input.description !== current.description) {
      fields.push('description');
      set.description = input.description;
    }
    if (input.active !== undefined && input.active !== current.active) {
      fields.push('active');
      set.active = input.active;
    }
    if (fields.length > 0) {
      await tx.update(traits).set(set).where(eq(traits.id, input.id));
      await traitAudit(tx, input.actorId, 'traits.updated', input.id, { fields });
    }
    return traitOrThrow(tx, input.id, 'updateTrait');
  });
}

/** @rfc RFC-62 R6 */
export async function createLevel(
  db: DbExecutor,
  input: { traitId: string; key: string; sortOrder?: number; actorId: string },
): Promise<Trait> {
  return db.transaction(async (tx) => {
    await requireTraitRow(tx, input.traitId);
    const [{ next }] = (await tx.execute(
      sql`select coalesce(max(sort_order), -1) + 1 as next from trait_levels where trait_id = ${input.traitId}`,
    )) as unknown as [{ next: number }];
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(traitLevels)
        .values({
          traitId: input.traitId,
          key: input.key,
          sortOrder: input.sortOrder ?? next,
          createdBy: input.actorId,
        })
        .returning({ id: traitLevels.id });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('LEVEL_KEY_TAKEN', 'The trait already has this level');
      throw err;
    }
    if (!row) throw new Error('createLevel: insert returned no row');
    await traitAudit(tx, input.actorId, 'traits.updated', input.traitId, {
      levelId: row.id,
      fields: ['levels'],
    });
    return traitOrThrow(tx, input.traitId, 'createLevel');
  });
}

/** Renaming keeps every record's `level_id` and `value_text`. @rfc RFC-62 R6 */
export async function updateLevel(
  db: DbExecutor,
  input: {
    traitId: string;
    levelId: string;
    key?: string;
    sortOrder?: number;
    active?: boolean;
    actorId: string;
  },
): Promise<Trait> {
  return db.transaction(async (tx) => {
    await requireTraitRow(tx, input.traitId);
    const [current] = await tx
      .select()
      .from(traitLevels)
      .where(and(eq(traitLevels.id, input.levelId), eq(traitLevels.traitId, input.traitId)))
      .limit(1);
    if (!current) throw new AppError('LEVEL_NOT_FOUND', 'Level not found');
    const fields: string[] = [];
    const set: { key?: string; sortOrder?: number; active?: boolean } = {};
    if (input.key !== undefined && input.key !== current.key) {
      fields.push('key');
      set.key = input.key;
    }
    if (input.sortOrder !== undefined && input.sortOrder !== current.sortOrder) {
      fields.push('sortOrder');
      set.sortOrder = input.sortOrder;
    }
    if (input.active !== undefined && input.active !== current.active) {
      fields.push('active');
      set.active = input.active;
    }
    if (fields.length > 0) {
      try {
        await tx.update(traitLevels).set(set).where(eq(traitLevels.id, input.levelId));
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('LEVEL_KEY_TAKEN', 'The trait already has this level');
        throw err;
      }
      await traitAudit(tx, input.actorId, 'traits.updated', input.traitId, {
        levelId: input.levelId,
        fields,
      });
    }
    return traitOrThrow(tx, input.traitId, 'updateLevel');
  });
}
