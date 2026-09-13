import { createFileRoute } from '@tanstack/react-router';
import { SpeciesSearchPage } from '../../../pages/dataset/SpeciesSearchPage.tsx';

/** `?unresolved=true` opens the search with the unresolved-taxa toggle on (RFC-65 — the unresolved-taxa queue). */
function validateSearch(search: Record<string, unknown>): { unresolved?: boolean } {
  return search.unresolved === true || search.unresolved === 'true' ? { unresolved: true } : {};
}

function SpeciesSearchRoute() {
  const { unresolved } = Route.useSearch();
  return <SpeciesSearchPage initialUnresolved={unresolved === true} />;
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-60 R6
 */
export const Route = createFileRoute('/app/species/')({
  validateSearch,
  component: SpeciesSearchRoute,
});
