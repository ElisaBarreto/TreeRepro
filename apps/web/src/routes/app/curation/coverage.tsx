import { createFileRoute } from '@tanstack/react-router';
import { textParam, uuidParam } from '../../../lib/search-params.ts';
import { CoveragePage, type CoverageSearch } from '../../../pages/curation/CoveragePage.tsx';

/**
 * Every filter of the coverage page as a search param (spec §5): the two
 * ids must look like uuids, the category a known-shaped key — every key
 * answered so nothing unvalidated reaches a control or the API.
 */
function validateSearch(search: Record<string, unknown>): CoverageSearch {
  return {
    familyId: uuidParam(search.familyId),
    categoryKey: textParam(search.categoryKey, 100),
    plotId: uuidParam(search.plotId),
  };
}

function CoverageRoute() {
  const navigate = Route.useNavigate();
  return (
    <CoveragePage
      search={Route.useSearch()}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-69 R5, R7
 */
export const Route = createFileRoute('/app/curation/coverage')({
  validateSearch,
  component: CoverageRoute,
});
