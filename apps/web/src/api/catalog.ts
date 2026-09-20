import type { QueryClient } from '@tanstack/react-query';
import {
  type CreateGenusBody,
  type CreateLevelBody,
  type CreateReferenceBody,
  type CreateSpeciesBody,
  type CreateTraitBody,
  type DataEnvelope,
  dataEnvelopeSchema,
  type FamilyBody,
  type Genus,
  genusSchema,
  type ReferenceDetail,
  referenceDetailSchema,
  type Species,
  type SpeciesNameBody,
  speciesSchema,
  type TaxonRef,
  type Trait,
  taxonRefSchema,
  traitSchema,
  type UpdateGenusBody,
  type UpdateLevelBody,
  type UpdateReferenceBody,
  type UpdateSpeciesBody,
  type UpdateTraitBody,
} from '@treerepro/contracts';
import type { z } from 'zod';
import { apiFetch } from './client.ts';

async function post<T>(path: string, json: unknown, schema: z.ZodType<T>): Promise<T> {
  const envelope: DataEnvelope<T> = await apiFetch(path, dataEnvelopeSchema(schema), {
    method: 'POST',
    json,
  });
  return envelope.data;
}
async function patch<T>(path: string, json: unknown, schema: z.ZodType<T>): Promise<T> {
  const envelope: DataEnvelope<T> = await apiFetch(path, dataEnvelopeSchema(schema), {
    method: 'PATCH',
    json,
  });
  return envelope.data;
}

/** @rfc RFC-60 R9 */
export function createFamily(body: FamilyBody): Promise<TaxonRef> {
  return post('/families', body, taxonRefSchema);
}
/** @rfc RFC-60 R9 */
export function updateFamily(id: string, body: FamilyBody): Promise<TaxonRef> {
  return patch(`/families/${id}`, body, taxonRefSchema);
}
/** @rfc RFC-60 R9 */
export function createGenus(body: CreateGenusBody): Promise<Genus> {
  return post('/genera', body, genusSchema);
}
/** @rfc RFC-60 R9 */
export function updateGenus(id: string, body: UpdateGenusBody): Promise<Genus> {
  return patch(`/genera/${id}`, body, genusSchema);
}
/** @rfc RFC-60 R9 */
export function createSpecies(body: CreateSpeciesBody): Promise<Species> {
  return post('/species', body, speciesSchema);
}
/** @rfc RFC-60 R9 */
export function updateSpecies(id: string, body: UpdateSpeciesBody): Promise<Species> {
  return patch(`/species/${id}`, body, speciesSchema);
}
/** @rfc RFC-60 R9 */
export function addSpeciesName(id: string, body: SpeciesNameBody): Promise<Species> {
  return post(`/species/${id}/names`, body, speciesSchema);
}
/** @rfc RFC-61 R6 */
export function createReference(body: CreateReferenceBody): Promise<ReferenceDetail> {
  return post('/references', body, referenceDetailSchema);
}
/** @rfc RFC-61 R6 */
export function updateReference(id: string, body: UpdateReferenceBody): Promise<ReferenceDetail> {
  return patch(`/references/${id}`, body, referenceDetailSchema);
}
/** @rfc RFC-62 R6 */
export function createTrait(body: CreateTraitBody): Promise<Trait> {
  return post('/traits', body, traitSchema);
}
/** @rfc RFC-62 R6 */
export function updateTrait(id: string, body: UpdateTraitBody): Promise<Trait> {
  return patch(`/traits/${id}`, body, traitSchema);
}
/** Answers the parent trait with its levels. @rfc RFC-62 R6 */
export function createLevel(traitId: string, body: CreateLevelBody): Promise<Trait> {
  return post(`/traits/${traitId}/levels`, body, traitSchema);
}
/** Answers the parent trait with its levels. @rfc RFC-62 R6 */
export function updateLevel(
  traitId: string,
  levelId: string,
  body: UpdateLevelBody,
): Promise<Trait> {
  return patch(`/traits/${traitId}/levels/${levelId}`, body, traitSchema);
}

export type CatalogArea = 'taxa' | 'references' | 'traits';

const STALE_AFTER: Record<CatalogArea, readonly (readonly string[])[]> = {
  // Records and species items carry family, genus and species names.
  taxa: [['families'], ['genera'], ['species'], ['records']],
  // Record items and details carry citation keys; the list and detail the edit itself.
  references: [['references'], ['records']],
  // Species summaries and record items carry level keys; the dictionary the edit itself.
  traits: [['traits'], ['species'], ['records']],
};

/**
 * After a catalog write, every query that renders a name or key of that
 * area is stale; the prefixes are the `datasetKeys` roots.
 * @rfc RFC-13 R6
 */
export async function invalidateAfterCatalogWrite(
  queryClient: QueryClient,
  area: CatalogArea,
): Promise<void> {
  await Promise.all(
    STALE_AFTER[area].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
