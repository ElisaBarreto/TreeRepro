import { useQuery } from '@tanstack/react-query';
import {
  dataEnvelopeSchema,
  type MapEntry,
  type MapKind,
  mapsResponseSchema,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';

/** Query keys of the maps pages. @rfc RFC-76 R6 */
export const mapsKeys = { all: ['maps'] as const };

/** `GET /api/maps`, in manifest order. @rfc RFC-76 R4 */
export async function fetchMaps(): Promise<MapEntry[]> {
  return (await apiFetch('/maps', dataEnvelopeSchema(mapsResponseSchema))).data;
}

/**
 * The same-origin, session-guarded URL of a map file (RFC-76 R5) — never
 * built from anything but a `file` this viewer's own `/api/maps` answer
 * named, so a name the manifest does not list is never reached this way.
 * @rfc RFC-76 R5
 */
export function mapFileUrl(file: string): string {
  return `/api/maps/files/${encodeURIComponent(file)}`;
}

/**
 * Every map entry grouped by its trait, in the manifest order `entries`
 * already carries (RFC-76 R4).
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

/** How each map kind reads (RFC-76 R6, R7); the wire code stays the value. @rfc RFC-76 R1 */
export const MAP_KIND_LABELS: Record<MapKind, string> = {
  completeness: 'Data completeness',
  prevalence: 'Prevalence',
  mean: 'Mean',
  min: 'Min',
  max: 'Max',
  sd: 'SD',
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
