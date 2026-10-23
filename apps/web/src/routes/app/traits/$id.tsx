import { createFileRoute } from '@tanstack/react-router';
import { SORT_ORDERS, TRAIT_SPECIES_MODES, TRAIT_SPECIES_SORTS } from '@treerepro/contracts';
import { enumParam, textParam, uuidParam } from '../../../lib/search-params.ts';
import { TraitPage, type TraitSpeciesSearch } from '../../../pages/dataset/TraitPage.tsx';

/**
 * Which tab is open, the taxonomy filters both tables share and the state the
 * with-data table is narrowed to (RFC-62 R8),
 * every key answered so nothing unvalidated reaches a control or the API.
 */
function validateSearch(search: Record<string, unknown>): TraitSpeciesSearch {
  return {
    mode: enumParam(search.mode, TRAIT_SPECIES_MODES),
    q: textParam(search.q, 100),
    familyId: uuidParam(search.familyId),
    genusId: uuidParam(search.genusId),
    level: uuidParam(search.level),
    sort: enumParam(search.sort, TRAIT_SPECIES_SORTS),
    order: enumParam(search.order, SORT_ORDERS),
  };
}

function TraitRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <TraitPage
      key={id}
      id={id}
      search={Route.useSearch()}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-62 R7, R8
 */
export const Route = createFileRoute('/app/traits/$id')({
  validateSearch,
  component: TraitRoute,
});
