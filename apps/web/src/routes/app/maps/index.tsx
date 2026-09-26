import { createFileRoute } from '@tanstack/react-router';
import { textParam } from '../../../lib/search-params.ts';
import { MapsPage, type MapsSearch } from '../../../pages/maps/MapsPage.tsx';

/** The selected category and trait (RFC-76 R6), every key answered. */
function validateSearch(search: Record<string, unknown>): MapsSearch {
  return { category: textParam(search.category, 100), trait: textParam(search.trait, 100) };
}

function MapsRoute() {
  const navigate = Route.useNavigate();
  return (
    <MapsPage
      search={Route.useSearch()}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-76 R6
 */
export const Route = createFileRoute('/app/maps/')({
  validateSearch,
  component: MapsRoute,
});
