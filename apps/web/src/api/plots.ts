import type {
  CreatePlotBody,
  DataEnvelope,
  Plot,
  PlotDetail,
  PlotSpeciesBody,
  PlotUser,
  SpeciesListItem,
  UpdatePlotBody,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';
import type { Page } from './dataset.ts';
import { type QueryParams, withQuery } from './query.ts';

/** Query keys of the plot pages; every fetcher below owns one. @rfc RFC-67 R3 */
export const plotKeys = {
  all: ['plots'] as const,
  list: (params: QueryParams) => ['plots', 'list', params] as const,
  fullList: ['plots', 'list', 'all'] as const,
  detail: (id: string) => ['plots', 'detail', id] as const,
  species: (id: string, params: QueryParams) => ['plots', id, 'species', params] as const,
  users: (id: string, params: QueryParams) => ['plots', id, 'users', params] as const,
};

/** @rfc RFC-67 R3 */
export function listPlots(params: {
  q?: string;
  cursor?: string;
  limit?: number;
}): Promise<Page<Plot>> {
  return apiFetch<Page<Plot>>(withQuery('/plots', params));
}

/**
 * Every plot, following `nextCursor` to exhaustion, for the selects that must
 * offer the whole list rather than a page of it — a single page silently drops
 * every plot past its limit, and the chooser then cannot express a filter the
 * API would accept. `fetchFamilies` pages the same way for the same reason.
 * @rfc RFC-67 R3
 */
export async function fetchAllPlots(): Promise<Plot[]> {
  const all: Plot[] = [];
  let cursor: string | undefined;
  do {
    const page = await listPlots({ cursor, limit: 200 });
    all.push(...page.data);
    cursor = page.meta.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

/** @rfc RFC-67 R3 */
export async function fetchPlot(id: string): Promise<PlotDetail> {
  const { data } = await apiFetch<DataEnvelope<PlotDetail>>(`/plots/${id}`);
  return data;
}

/** @rfc RFC-67 R4 */
export function fetchPlotSpecies(
  id: string,
  params: { q?: string; cursor?: string; limit?: number },
): Promise<Page<SpeciesListItem>> {
  return apiFetch<Page<SpeciesListItem>>(withQuery(`/plots/${id}/species`, params));
}

/** @rfc RFC-67 R4 */
export function fetchPlotUsers(
  id: string,
  params: { cursor?: string; limit?: number },
): Promise<Page<PlotUser>> {
  return apiFetch<Page<PlotUser>>(withQuery(`/plots/${id}/users`, params));
}

/** @rfc RFC-67 R5 */
export async function createPlot(body: CreatePlotBody): Promise<PlotDetail> {
  const { data } = await apiFetch<DataEnvelope<PlotDetail>>('/plots', {
    method: 'POST',
    json: body,
  });
  return data;
}

/** @rfc RFC-67 R5 */
export async function updatePlot(id: string, body: UpdatePlotBody): Promise<PlotDetail> {
  const { data } = await apiFetch<DataEnvelope<PlotDetail>>(`/plots/${id}`, {
    method: 'PATCH',
    json: body,
  });
  return data;
}

/** @rfc RFC-67 R5 */
export async function addPlotSpecies(plotId: string, body: PlotSpeciesBody): Promise<PlotDetail> {
  const { data } = await apiFetch<DataEnvelope<PlotDetail>>(`/plots/${plotId}/species`, {
    method: 'POST',
    json: body,
  });
  return data;
}

/** @rfc RFC-67 R5 */
export async function removePlotSpecies(plotId: string, speciesId: string): Promise<PlotDetail> {
  const { data } = await apiFetch<DataEnvelope<PlotDetail>>(
    `/plots/${plotId}/species/${speciesId}`,
    { method: 'DELETE' },
  );
  return data;
}
