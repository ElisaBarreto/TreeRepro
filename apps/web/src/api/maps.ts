import { useQuery } from '@tanstack/react-query';
import {
  dataEnvelopeSchema,
  type MapEntry,
  type MapKind,
  type MapValues,
  mapsResponseSchema,
  mapValuesSchema,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';

/** Query keys of the maps pages. @rfc RFC-76 R7 */
export const mapsKeys = {
  all: ['maps'] as const,
  values: (entry: MapEntry) =>
    ['maps', 'values', entry.traitId, entry.kind, entry.levelId, entry.computedAt] as const,
};

/** `GET /api/maps`, by trait key, kind and state. @rfc RFC-76 R5 */
export async function fetchMaps(): Promise<MapEntry[]> {
  return (await apiFetch('/maps', dataEnvelopeSchema(mapsResponseSchema))).data;
}

/** `GET /api/maps/values` for one map (RFC-76 R6). @rfc RFC-76 R6 */
export async function fetchMapValues(entry: MapEntry): Promise<MapValues> {
  const params = new URLSearchParams({ traitId: entry.traitId, kind: entry.kind });
  if (entry.levelId) params.set('levelId', entry.levelId);
  return (await apiFetch(`/maps/values?${params}`, dataEnvelopeSchema(mapValuesSchema))).data;
}

/** One map's regions and legend; fixed for a given snapshot, so cached by its time. @rfc RFC-76 R7 */
export function useMapValues(entry: MapEntry) {
  return useQuery({
    queryKey: mapsKeys.values(entry),
    queryFn: () => fetchMapValues(entry),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Every map entry grouped by its trait, in the order `entries` already
 * carries (RFC-76 R5).
 * @rfc RFC-76 R6
 */
export function mapsByTrait(entries: readonly MapEntry[]): Map<string, MapEntry[]> {
  const byTrait = new Map<string, MapEntry[]>();
  for (const entry of entries) {
    const list = byTrait.get(entry.traitId);
    if (list) list.push(entry);
    else byTrait.set(entry.traitId, [entry]);
  }
  return byTrait;
}

/** @rfc RFC-76 R6 */
export function useMaps() {
  return useQuery({ queryKey: mapsKeys.all, queryFn: fetchMaps });
}

/**
 * Whether a trait has any maps at all — the one check a trait card's help
 * popover (`TraitCard`, `EmptyTraitCard`) and the traits list share, so it
 * lives here once rather than repeated at each call site. A failed maps
 * query reads as no maps, the same as everywhere else `useMaps` is read.
 * @rfc RFC-76 R8
 */
export function useHasMaps(traitId: string): boolean {
  const maps = useMaps();
  return (mapsByTrait(maps.data ?? []).get(traitId) ?? []).length > 0;
}

/** How each map kind reads (RFC-76 R7); the wire code stays the value. @rfc RFC-76 R1 */
export const MAP_KIND_LABELS: Record<MapKind, string> = {
  completeness: 'Data completeness',
  mean: 'Mean',
  median: 'Median',
  sd: 'SD',
  cv: 'CV',
  min: 'Min',
  max: 'Max',
  prevalence: 'Prevalence',
};

/**
 * The alt text of a map image: kind and trait, plus the level for a
 * prevalence map (`"Prevalence map of Flower color: red"`).
 * @rfc RFC-76 R7
 */
export function mapAlt(kind: MapKind, traitName: string, levelName?: string): string {
  const level = levelName ? `: ${levelName}` : '';
  return `${MAP_KIND_LABELS[kind]} map of ${traitName}${level}`;
}
