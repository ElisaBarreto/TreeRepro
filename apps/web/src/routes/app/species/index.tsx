import { createFileRoute } from '@tanstack/react-router';
import { SpeciesSearchPage } from '../../../pages/dataset/SpeciesSearchPage.tsx';

/** `?unresolved=true` opens the search with the unresolved-taxa toggle on (RFC-65); `scope` and `plotId` per RFC-33 R6, RFC-67 R8. */
function validateSearch(search: Record<string, unknown>): {
  unresolved?: boolean;
  scope?: 'plots' | 'all';
  plotId?: string;
} {
  const result: { unresolved?: boolean; scope?: 'plots' | 'all'; plotId?: string } = {};
  if (search.unresolved === true || search.unresolved === 'true') result.unresolved = true;
  if (search.scope === 'plots' || search.scope === 'all') result.scope = search.scope;
  if (typeof search.plotId === 'string' && search.plotId.trim() !== '') {
    result.plotId = search.plotId.trim();
  }
  return result;
}

// The page seeds its form state once, and the router keeps this component
// mounted across a search-only change (Species <-> Unresolved taxa in the
// sidebar); the key remounts it so the toggle follows the URL.
function SpeciesSearchRoute() {
  const { unresolved, scope, plotId } = Route.useSearch();
  return (
    <SpeciesSearchPage
      key={`${unresolved ? 'unresolved' : 'all'}:${scope ?? 'default'}:${plotId ?? 'all'}`}
      initialUnresolved={unresolved === true}
      initialScope={scope}
      initialPlotId={plotId}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-60 R6
 */
export const Route = createFileRoute('/app/species/')({
  validateSearch,
  component: SpeciesSearchRoute,
});
