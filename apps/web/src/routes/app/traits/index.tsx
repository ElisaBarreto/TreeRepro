import { createFileRoute } from '@tanstack/react-router';
import { TRAIT_VALUE_TYPES } from '@treerepro/contracts';
import { enumParam, textParam, uuidParam } from '../../../lib/search-params.ts';
import { TraitsPage, type TraitsSearch } from '../../../pages/dataset/TraitsPage.tsx';

/**
 * The dictionary filters as search params (RFC-62 R5 amendment): the
 * category key is free text the API matches, the trait must look like a uuid
 * and the value type must be one of the two. Every key is answered, so a
 * malformed value never reaches a control or the API.
 */
function validateSearch(search: Record<string, unknown>): TraitsSearch {
  return {
    categoryKey: textParam(search.categoryKey, 100),
    traitId: uuidParam(search.traitId),
    valueType: enumParam(search.valueType, TRAIT_VALUE_TYPES),
  };
}

function TraitsRoute() {
  const navigate = Route.useNavigate();
  return (
    <TraitsPage
      search={Route.useSearch()}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-62 R5
 */
export const Route = createFileRoute('/app/traits/')({
  validateSearch,
  component: TraitsRoute,
});
