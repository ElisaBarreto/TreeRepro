import type { QueryClient } from '@tanstack/react-query';
import type {
  CreateGenusBody,
  CreateLevelBody,
  CreateReferenceBody,
  CreateSpeciesBody,
  CreateTraitBody,
  DataEnvelope,
  FamilyBody,
  Genus,
  ReferenceDetail,
  Species,
  SpeciesNameBody,
  TaxonRef,
  Trait,
  UpdateGenusBody,
  UpdateLevelBody,
  UpdateReferenceBody,
  UpdateSpeciesBody,
  UpdateTraitBody,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';

async function post<T>(path: string, json: unknown): Promise<T> {
  return (await apiFetch<DataEnvelope<T>>(path, { method: 'POST', json })).data;
}
async function patch<T>(path: string, json: unknown): Promise<T> {
  return (await apiFetch<DataEnvelope<T>>(path, { method: 'PATCH', json })).data;
}

/** @rfc RFC-60 R9 */
export function createFamily(body: FamilyBody): Promise<TaxonRef> {
  return post('/families', body);
}
/** @rfc RFC-60 R9 */
export function updateFamily(id: string, body: FamilyBody): Promise<TaxonRef> {
  return patch(`/families/${id}`, body);
}
/** @rfc RFC-60 R9 */
export function createGenus(body: CreateGenusBody): Promise<Genus> {
  return post('/genera', body);
}
/** @rfc RFC-60 R9 */
export function updateGenus(id: string, body: UpdateGenusBody): Promise<Genus> {
  return patch(`/genera/${id}`, body);
}
/** @rfc RFC-60 R9 */
export function createSpecies(body: CreateSpeciesBody): Promise<Species> {
  return post('/species', body);
}
/** @rfc RFC-60 R9 */
export function updateSpecies(id: string, body: UpdateSpeciesBody): Promise<Species> {
  return patch(`/species/${id}`, body);
}
/** @rfc RFC-60 R9 */
export function addSpeciesName(id: string, body: SpeciesNameBody): Promise<Species> {
  return post(`/species/${id}/names`, body);
}
/** @rfc RFC-61 R6 */
export function createReference(body: CreateReferenceBody): Promise<ReferenceDetail> {
  return post('/references', body);
}
/** @rfc RFC-61 R6 */
export function updateReference(id: string, body: UpdateReferenceBody): Promise<ReferenceDetail> {
  return patch(`/references/${id}`, body);
}
/** @rfc RFC-62 R6 */
export function createTrait(body: CreateTraitBody): Promise<Trait> {
  return post('/traits', body);
}
/** @rfc RFC-62 R6 */
export function updateTrait(id: string, body: UpdateTraitBody): Promise<Trait> {
  return patch(`/traits/${id}`, body);
}
/** Answers the parent trait with its levels. @rfc RFC-62 R6 */
export function createLevel(traitId: string, body: CreateLevelBody): Promise<Trait> {
  return post(`/traits/${traitId}/levels`, body);
}
/** Answers the parent trait with its levels. @rfc RFC-62 R6 */
export function updateLevel(
  traitId: string,
  levelId: string,
  body: UpdateLevelBody,
): Promise<Trait> {
  return patch(`/traits/${traitId}/levels/${levelId}`, body);
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
