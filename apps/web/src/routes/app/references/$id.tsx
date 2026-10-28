import { createFileRoute } from '@tanstack/react-router';
import { RECORD_SORTS, SORT_ORDERS } from '@treerepro/contracts';
import { enumParam, textParam, uuidParam } from '../../../lib/search-params.ts';
import { ReferencePage, type ReferenceSearch } from '../../../pages/dataset/ReferencePage.tsx';

/**
 * The reference's records filters as search params (issue #351): the trait
 * must look like a uuid, the species search is free text, the sort one of
 * the records list's. A malformed value never reaches a control or the API.
 */
function validateSearch(search: Record<string, unknown>): ReferenceSearch {
  return {
    traitId: uuidParam(search.traitId),
    q: textParam(search.q, 100),
    sort: enumParam(search.sort, RECORD_SORTS),
    order: enumParam(search.order, SORT_ORDERS),
  };
}

function ReferenceRoute() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <ReferencePage
      key={id}
      id={id}
      search={Route.useSearch()}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-61 R4
 * @rfc RFC-63 R9
 */
export const Route = createFileRoute('/app/references/$id')({
  validateSearch,
  component: ReferenceRoute,
});
