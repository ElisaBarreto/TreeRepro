import { createFileRoute } from '@tanstack/react-router';
import { PENDING_SORTS, type PendingSort, SORT_ORDERS, type SortOrder } from '@treerepro/contracts';
import { enumParam } from '../../../lib/search-params.ts';
import { PendingPage } from '../../../pages/curation/PendingPage.tsx';

/**
 * `?traitId=` selects the trait whose groups the queue shows, `?sort=&order=`
 * their order (RFC-65 R8, RFC-13 R13).
 */
function validateSearch(search: Record<string, unknown>): {
  traitId?: string;
  sort?: PendingSort;
  order?: SortOrder;
} {
  return {
    traitId:
      typeof search.traitId === 'string' && search.traitId !== '' ? search.traitId : undefined,
    sort: enumParam(search.sort, PENDING_SORTS),
    order: enumParam(search.order, SORT_ORDERS),
  };
}

// Choosing a trait replaces the entry rather than pushing one: the queue is
// one screen, and Back should leave it, not step through every trait tried.
function PendingRoute() {
  const { traitId, sort, order } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PendingPage
      traitId={traitId}
      sort={sort ? { sort, order: order ?? 'asc' } : undefined}
      // A new trait keeps the order its groups are read in.
      onSelectTrait={(next) => navigate({ search: { traitId: next, sort, order }, replace: true })}
      onSort={(next) => navigate({ search: { traitId, ...next }, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-65 R8
 */
export const Route = createFileRoute('/app/curation/pending')({
  validateSearch,
  component: PendingRoute,
});
