import type { Genus, NameSource, Species, TaxonRef } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.ts';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import { normaliseName } from './names.ts';
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
    const created = await getSpecies(tx, row.id);
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
    actorId: string;
  },
): Promise<Species> {
  const canonicalName =
    input.canonicalName === undefined ? undefined : normaliseName(input.canonicalName);
  return db.transaction(async (tx) => {
    const current = await requireSpeciesRow(tx, input.id);
    const fields: string[] = [];
    const set: { canonicalName?: string; nameSource?: NameSource; genusId?: string | null } = {};
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
    const updated = await getSpecies(tx, input.id);
    if (!updated) throw new Error('updateSpecies: species vanished');
    return updated;
  });
}

/** @rfc RFC-60 R4, R9, R10 */
export async function addSpeciesName(
  db: DbExecutor,
  input: { speciesId: string; name: string; gbifUsageKey?: string; actorId: string },
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
        .values({ speciesId: input.speciesId, name, gbifUsageKey: input.gbifUsageKey ?? null })
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
    const updated = await getSpecies(tx, input.speciesId);
    if (!updated) throw new Error('addSpeciesName: species vanished');
    return updated;
  });
}
