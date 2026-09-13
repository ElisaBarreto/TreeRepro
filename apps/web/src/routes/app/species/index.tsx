import { createFileRoute } from '@tanstack/react-router';
import { SpeciesSearchPage } from '../../../pages/dataset/SpeciesSearchPage.tsx';

/** `?unresolved=true` opens the search with the unresolved-taxa toggle on (RFC-65 — the unresolved-taxa queue). */
function validateSearch(search: Record<string, unknown>): { unresolved?: boolean } {
  return search.unresolved === true || search.unresolved === 'true' ? { unresolved: true } : {};
}

// The page seeds its form state once, and the router keeps this component
// mounted across a search-only change (Species <-> Unresolved taxa in the
// sidebar); the key remounts it so the toggle follows the URL.
function SpeciesSearchRoute() {
  const { unresolved } = Route.useSearch();
  return (
    <SpeciesSearchPage
      key={unresolved ? 'unresolved' : 'all'}
      initialUnresolved={unresolved === true}
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
