import { createFileRoute } from '@tanstack/react-router';
import { textParam } from '../../../lib/search-params.ts';
import {
  PhylogeniesPage,
  type PhylogeniesSearch,
} from '../../../pages/phylogenies/PhylogeniesPage.tsx';

/** The selected category and trait (RFC-79 R6), every key answered. */
function validateSearch(search: Record<string, unknown>): PhylogeniesSearch {
  return { category: textParam(search.category, 100), trait: textParam(search.trait, 100) };
}

function PhylogeniesRoute() {
  const navigate = Route.useNavigate();
  return (
    <PhylogeniesPage
      search={Route.useSearch()}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-79 R6
 */
export const Route = createFileRoute('/app/phylogenies/')({
  validateSearch,
  component: PhylogeniesRoute,
});
