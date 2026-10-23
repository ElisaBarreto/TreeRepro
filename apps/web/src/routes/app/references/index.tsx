import { createFileRoute } from '@tanstack/react-router';
import { REFERENCE_SORTS, SORT_ORDERS } from '@treerepro/contracts';
import { enumParam, textParam, uuidParam } from '../../../lib/search-params.ts';
import { ReferencesPage, type ReferencesSearch } from '../../../pages/dataset/ReferencesPage.tsx';

/**
 * The references list's filters as search params (RFC-61 R4 amendment): the
 * category key is free text the API matches and the trait must look like a
 * uuid. Every key is answered, so a malformed value never reaches a control
 * or the API.
 */
function validateSearch(search: Record<string, unknown>): ReferencesSearch {
  return {
    categoryKey: textParam(search.categoryKey, 100),
    traitId: uuidParam(search.traitId),
    sort: enumParam(search.sort, REFERENCE_SORTS),
    order: enumParam(search.order, SORT_ORDERS),
  };
}

function ReferencesRoute() {
  const navigate = Route.useNavigate();
  return (
    <ReferencesPage
      search={Route.useSearch()}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-61 R4
 */
export const Route = createFileRoute('/app/references/')({
  validateSearch,
  component: ReferencesRoute,
});
