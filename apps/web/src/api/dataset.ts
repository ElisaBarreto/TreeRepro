import type {
  DataEnvelope,
  Dictionary,
  Genus,
  ImportBatch,
  ImportBatchKind,
  ImportReject,
  ListMeta,
  RecordDetail,
  RecordItem,
  Reference,
  ReferenceDetail,
  Species,
  SpeciesListItem,
  SpeciesStatus,
  SpeciesTraits,
  TaxonRef,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';
import { type QueryParams as Params, withQuery } from './query.ts';

export interface Page<T> {
  data: T[];
  meta: ListMeta;
}

/** Query keys of the dataset pages; every fetcher below owns one. @rfc RFC-60 R6 */
export const datasetKeys = {
  species: (params: Params) => ['species', params] as const,
  speciesDetail: (id: string) => ['species', id] as const,
  speciesTraits: (id: string) => ['species', id, 'traits'] as const,
  records: (params: Params) => ['records', params] as const,
  record: (id: string) => ['records', id] as const,
  dictionary: ['traits'] as const,
  references: (params: Params) => ['references', params] as const,
  reference: (id: string) => ['references', id] as const,
  families: ['families'] as const,
  genera: (params: Params) => ['genera', params] as const,
  imports: (params: Params) => ['imports', params] as const,
  importBatch: (id: string) => ['imports', id] as const,
  importRejects: (id: string) => ['imports', id, 'rejects'] as const,
};

/**
 * @rfc RFC-60 R6
 * @rfc RFC-33 R6
 * @rfc RFC-33 R7
 */
export function searchSpecies(params: {
  q?: string;
  familyId?: string;
  genusId?: string;
  unresolved?: boolean;
  status?: SpeciesStatus;
  scope?: 'plots' | 'all';
  plotId?: string;
  cursor?: string;
  limit?: number;
}) {
  return apiFetch<Page<SpeciesListItem>>(withQuery('/species', params));
}
/** @rfc RFC-60 R7 */
export async function fetchSpecies(id: string): Promise<Species> {
  return (await apiFetch<DataEnvelope<Species>>(`/species/${id}`)).data;
}
/** @rfc RFC-63 R10 */
export async function fetchSpeciesTraits(id: string): Promise<SpeciesTraits> {
  return (await apiFetch<DataEnvelope<SpeciesTraits>>(`/species/${id}/traits`)).data;
}
/** @rfc RFC-63 R9 */
export function fetchRecords(params: {
  speciesId?: string;
  traitId?: string;
  referenceId?: string;
  cursor?: string;
  limit?: number;
}) {
  return apiFetch<Page<RecordItem>>(withQuery('/records', params));
}
/** @rfc RFC-63 R8 */
export async function fetchRecord(id: string): Promise<RecordDetail> {
  return (await apiFetch<DataEnvelope<RecordDetail>>(`/records/${id}`)).data;
}
/** @rfc RFC-62 R5 */
export async function fetchDictionary(): Promise<Dictionary> {
  return (await apiFetch<DataEnvelope<Dictionary>>('/traits')).data;
}
/** @rfc RFC-61 R4 */
export function searchReferences(params: { q?: string; cursor?: string; limit?: number }) {
  return apiFetch<Page<Reference>>(withQuery('/references', params));
}
/** @rfc RFC-61 R4 */
export async function fetchReference(id: string): Promise<ReferenceDetail> {
  return (await apiFetch<DataEnvelope<ReferenceDetail>>(`/references/${id}`)).data;
}
/** @rfc RFC-60 R8 */
export async function fetchFamilies(): Promise<TaxonRef[]> {
  const all: TaxonRef[] = [];
  let cursor: string | undefined;
  do {
    const page = await apiFetch<Page<TaxonRef>>(withQuery('/families', { cursor, limit: 200 }));
    all.push(...page.data);
    cursor = page.meta.nextCursor ?? undefined;
  } while (cursor);
  return all;
}
/** @rfc RFC-60 R8 */
export function fetchGenera(params: {
  familyId?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}) {
  return apiFetch<Page<Genus>>(withQuery('/genera', params));
}
/**
 * @rfc RFC-64 R11
 * @rfc RFC-68 R7
 */
export function fetchImports(params: { kind?: ImportBatchKind; cursor?: string; limit?: number }) {
  return apiFetch<Page<ImportBatch>>(withQuery('/imports', params));
}
/** @rfc RFC-64 R11 */
export async function fetchImport(id: string): Promise<ImportBatch> {
  return (await apiFetch<DataEnvelope<ImportBatch>>(`/imports/${id}`)).data;
}
/** @rfc RFC-64 R11 */
export function fetchImportRejects(id: string, params: { cursor?: string; limit?: number }) {
  return apiFetch<Page<ImportReject>>(withQuery(`/imports/${id}/rejects`, params));
}
