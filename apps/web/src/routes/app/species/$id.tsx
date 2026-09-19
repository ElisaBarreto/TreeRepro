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
      // The toggle owns `missing` and nothing else: every other param is
      // spread through. `record` is the digest e-mail's deep link (R5), and
      // replacing the whole search dropped it on the first toggle, which left
      // the drawer open (it is seeded state) but the URL no longer
      // copy-pasteable.
      onMissingChange={(next) =>
        navigate({
          search: (prev) => ({ ...prev, ...(next ? { missing: true } : { missing: undefined }) }),
          replace: true,
        })
      }
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
