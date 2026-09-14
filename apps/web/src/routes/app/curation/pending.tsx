import { createFileRoute } from '@tanstack/react-router';
import { PendingPage } from '../../../pages/curation/PendingPage.tsx';

/** `?traitId=` selects the trait whose groups the queue shows (RFC-65 R8). */
function validateSearch(search: Record<string, unknown>): { traitId?: string } {
  return typeof search.traitId === 'string' && search.traitId !== ''
    ? { traitId: search.traitId }
    : {};
}

// Choosing a trait replaces the entry rather than pushing one: the queue is
// one screen, and Back should leave it, not step through every trait tried.
function PendingRoute() {
  const { traitId } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PendingPage
      traitId={traitId}
      onSelectTrait={(next) => navigate({ search: { traitId: next }, replace: true })}
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
