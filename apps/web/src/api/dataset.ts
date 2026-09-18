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
  SpeciesSort,
  SpeciesStatus,
  SpeciesTraits,
  TaxonRef,
  TraitDataMode,
  TraitDetail,
  TraitSpeciesItem,
  TraitSpeciesMode,
  TraitValueType,
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
  // `includeMissing` is part of the key: the two responses (with and without
  // the zero-count traits) must never share a cache entry, or flipping the
  // "Show traits with no data" checkbox would show stale data (RFC-70 R7).
  speciesTraits: (id: string, includeMissing: boolean) =>
    ['species', id, 'traits', includeMissing] as const,
  records: (params: Params) => ['records', params] as const,
  record: (id: string) => ['records', id] as const,
  // The filters are part of the key: a filtered dictionary and the whole
  // one (which every form's selects read) must never share a cache entry.
  dictionary: (params: Params = {}) => ['traits', params] as const,
  trait: (id: string) => ['traits', id] as const,
  traitSpecies: (id: string, params: Params) => ['traits', id, 'species', params] as const,
  references: (params: Params) => ['references', params] as const,
  reference: (id: string) => ['references', id] as const,
  families: ['families'] as const,
  genera: (params: Params) => ['genera', params] as const,
  imports: (params: Params) => ['imports', params] as const,
  importBatch: (id: string) => ['imports', id] as const,
  importRejects: (id: string) => ['imports', id, 'rejects'] as const,
};

/**
 * `categoryKey`, `traitId` and `traitData` are the coverage filters and
 * `sort` the order (RFC-60 R6 amendment); a cursor belongs to one order
 * only, so the caller starts over at page 1 whenever `sort` changes.
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
  categoryKey?: string;
  traitId?: string;
  traitData?: TraitDataMode;
  sort?: SpeciesSort;
  cursor?: string;
  limit?: number;
}) {
  return apiFetch<Page<SpeciesListItem>>(withQuery('/species', params));
}
/** @rfc RFC-60 R7 */
export async function fetchSpecies(id: string): Promise<Species> {
  return (await apiFetch<DataEnvelope<Species>>(`/species/${id}`)).data;
}
/**
 * `includeMissing` adds every visible active trait with no record yet, as a
 * zero-count entry (RFC-70 R7); the flag is left off the query string
 * entirely when it is not requested, so the request is unchanged from before.
 * @rfc RFC-63 R10
 * @rfc RFC-70 R7
 */
export async function fetchSpeciesTraits(
  id: string,
  options?: { includeMissing?: boolean },
): Promise<SpeciesTraits> {
  return (
    await apiFetch<DataEnvelope<SpeciesTraits>>(
      withQuery(`/species/${id}/traits`, { includeMissing: options?.includeMissing }),
    )
  ).data;
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
/**
 * The trait dictionary, whole by default. `categoryKey`, `valueType` and `q`
 * narrow it server-side, for the traits list's own filters and the deep
 * links they produce (RFC-62 R5 amendment); a form that fills selects from
 * the vocabulary asks for it unfiltered.
 * @rfc RFC-62 R5
 */
export async function fetchDictionary(
  params: { categoryKey?: string; valueType?: TraitValueType; q?: string } = {},
): Promise<Dictionary> {
  return (await apiFetch<DataEnvelope<Dictionary>>(withQuery('/traits', params))).data;
}
/** @rfc RFC-62 R7 */
export async function fetchTrait(id: string): Promise<TraitDetail> {
  return (await apiFetch<DataEnvelope<TraitDetail>>(`/traits/${id}`)).data;
}
/**
 * One page of the species of a trait: `mode=with` those that have a record
 * for it, `mode=missing` those that have none, narrowed by the taxonomy
 * filters and ordered like the species list.
 * @rfc RFC-62 R8
 * @rfc RFC-33 R6
 */
export function fetchTraitSpecies(
  id: string,
  params: {
    mode?: TraitSpeciesMode;
    q?: string;
    familyId?: string;
    genusId?: string;
    scope?: 'plots' | 'all';
    plotId?: string;
    cursor?: string;
    limit?: number;
  },
) {
  return apiFetch<Page<TraitSpeciesItem>>(withQuery(`/traits/${id}/species`, params));
}
/**
 * `categoryKey` and `traitId` are the references list's own filters (RFC-61
 * R4 amendment): a link from a trait or a category page narrows the
 * bibliography to what cites it.
 * @rfc RFC-61 R4
 */
export function searchReferences(params: {
  q?: string;
  categoryKey?: string;
  traitId?: string;
  cursor?: string;
  limit?: number;
}) {
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
