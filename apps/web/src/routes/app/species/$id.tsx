import { createFileRoute } from '@tanstack/react-router';
import { uuidParam } from '../../../lib/search-params.ts';
import { SpeciesPage } from '../../../pages/dataset/SpeciesPage.tsx';

/**
 * `?missing=true` shows every active trait with no record yet (RFC-70 R7).
 * `?record=<uuid>` is the digest e-mail's deep link (RFC-74 R5): it opens
 * the record drawer on mount, exactly like clicking the row would.
 */
function validateSearch(search: Record<string, unknown>): {
  missing?: boolean;
  record?: string;
} {
  return {
    ...(search.missing === true || search.missing === 'true' ? { missing: true } : {}),
    record: uuidParam(search.record),
  };
}

function SpeciesRoute() {
  const { id } = Route.useParams();
  const { missing, record } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SpeciesPage
      key={id}
      id={id}
      missing={missing === true}
      onMissingChange={(next) => navigate({ search: next ? { missing: true } : {}, replace: true })}
      initialRecordId={record}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-60 R7
 * @rfc RFC-70 R7
 * @rfc RFC-74 R5
 */
export const Route = createFileRoute('/app/species/$id')({
  validateSearch,
  component: SpeciesRoute,
});
