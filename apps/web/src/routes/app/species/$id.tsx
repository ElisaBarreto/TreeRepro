import { createFileRoute } from '@tanstack/react-router';
import { SpeciesPage } from '../../../pages/dataset/SpeciesPage.tsx';

/** `?missing=true` shows every active trait with no record yet (RFC-70 R7). */
function validateSearch(search: Record<string, unknown>): { missing?: boolean } {
  return search.missing === true || search.missing === 'true' ? { missing: true } : {};
}

function SpeciesRoute() {
  const { id } = Route.useParams();
  const { missing } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SpeciesPage
      key={id}
      id={id}
      missing={missing === true}
      onMissingChange={(next) => navigate({ search: next ? { missing: true } : {}, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-60 R7
 * @rfc RFC-70 R7
 */
export const Route = createFileRoute('/app/species/$id')({
  validateSearch,
  component: SpeciesRoute,
});
