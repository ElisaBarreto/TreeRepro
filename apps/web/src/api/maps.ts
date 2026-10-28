import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dataEnvelopeSchema,
  type MapEntry,
  type MapKind,
  type MapValues,
  mapsResponseSchema,
  type TraitMaps,
  traitMapsSchema,
} from '@treerepro/contracts';
import { useEffect } from 'react';
import { apiFetch } from './client.ts';

/** Query keys of the maps pages. @rfc RFC-76 R7 */
export const mapsKeys = {
  all: ['maps'] as const,
  trait: (traitId: string, computedAt: string) => ['maps', 'trait', traitId, computedAt] as const,
};

/** `GET /api/maps`, by trait key, kind and state. @rfc RFC-76 R5 */
export async function fetchMaps(): Promise<MapEntry[]> {
  return (await apiFetch('/maps', dataEnvelopeSchema(mapsResponseSchema))).data;
}

/** `GET /api/maps/trait-values`: every map of one trait (RFC-76 R9). @rfc RFC-76 R9 */
export async function fetchTraitMaps(traitId: string): Promise<TraitMaps> {
  const params = new URLSearchParams({ traitId });
  return (await apiFetch(`/maps/trait-values?${params}`, dataEnvelopeSchema(traitMapsSchema))).data;
}

// A trait's maps are fixed for a given snapshot, so they are cached by its
// time and kept for the whole session (RFC-76 R10).
function traitMapsQuery(traitId: string, computedAt: string) {
  return {
    queryKey: mapsKeys.trait(traitId, computedAt),
    queryFn: () => fetchTraitMaps(traitId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  };
}

/**
 * One map's regions and legend, read from its trait's answer: every map of
 * a trait costs that trait's one request (RFC-76 R10).
 * @rfc RFC-76 R10
 */
export function useMapValues(entry: MapEntry) {
  return useQuery({
    ...traitMapsQuery(entry.traitId, entry.computedAt),
    select: (trait): MapValues => {
      const map = trait.maps.find((m) => m.kind === entry.kind && m.levelId === entry.levelId);
      if (!map) throw new Error('Map not found');
      return { regions: map.regions, legend: map.legend, computedAt: trait.computedAt };
    },
  });
}

/**
 * Fetches, in the background, the maps of every trait among `entries` — a
 * category's — so choosing one finds its maps already loaded (RFC-76 R10).
 * @rfc RFC-76 R10
 */
export function usePrefetchTraitMaps(entries: readonly MapEntry[]) {
  const queryClient = useQueryClient();
  // One `traitId@computedAt` per trait: a string, so a new `entries` array
  // holding the same traits does not prefetch again.
  const key = [...new Set(entries.map((e) => `${e.traitId}@${e.computedAt}`))].join(' ');
  useEffect(() => {
    for (const pair of key ? key.split(' ') : []) {
      const [traitId = '', computedAt = ''] = pair.split('@');
      void queryClient.prefetchQuery(traitMapsQuery(traitId, computedAt));
    }
  }, [key, queryClient]);
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
