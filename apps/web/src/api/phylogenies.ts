import { useQuery } from '@tanstack/react-query';
import {
  dataEnvelopeSchema,
  type PhylogenyFigure,
  phylogeniesResponseSchema,
} from '@treerepro/contracts';
import { apiFetch } from './client.ts';

/** `GET /api/phylogenies`: coverage first, then by trait key. @rfc RFC-79 R2 */
export async function fetchPhylogenies(): Promise<PhylogenyFigure[]> {
  return (await apiFetch('/phylogenies', dataEnvelopeSchema(phylogeniesResponseSchema))).data;
}

/**
 * The platform's figures, fetched once per session: they change only when the
 * owner publishes, and each URL carries its version (RFC-79 R3).
 * @rfc RFC-79 R2
 */
export function usePhylogenies() {
  return useQuery({
    queryKey: ['phylogenies'],
    queryFn: fetchPhylogenies,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** A figure's display copy or full PNG. @rfc RFC-79 R3 */
export function figureUrl(figure: PhylogenyFigure, size: 'display' | 'full'): string {
  const params = new URLSearchParams({ size, v: figure.version });
  return `/api/phylogenies/files/${figure.key}?${params}`;
}

/** Trait figures by trait id; coverage has none. @rfc RFC-79 R6, R7 */
export function phylogenyByTrait(
  figures: readonly PhylogenyFigure[],
): Map<string, PhylogenyFigure> {
  return new Map(figures.flatMap((f) => (f.traitId ? [[f.traitId, f] as const] : [])));
}

/**
 * Whether a trait has a phylogeny figure — the trait cards' help popover
 * check, like `useHasMaps`. A failed query reads as none.
 * @rfc RFC-79 R7
 */
export function useHasPhylogeny(traitId: string): boolean {
  return phylogenyByTrait(usePhylogenies().data ?? []).has(traitId);
}
