import { createFileRoute } from '@tanstack/react-router';
import { PROPOSAL_STATUSES } from '@treerepro/contracts';
import { enumParam } from '../../../lib/search-params.ts';
import { ProposalsPage, type ProposalsSearch } from '../../../pages/curation/ProposalsPage.tsx';

/**
 * The queue's one control is a search param (RFC-75 R3): a status outside
 * the enum is dropped rather than passed on, so nothing unvalidated reaches
 * the control or the API, and the queue falls back to the open proposals —
 * the same default the API applies.
 */
function validateSearch(search: Record<string, unknown>): ProposalsSearch {
  return { status: enumParam(search.status, PROPOSAL_STATUSES) };
}

function ProposalsRoute() {
  const navigate = Route.useNavigate();
  return (
    <ProposalsPage
      search={Route.useSearch()}
      // One screen: changing the status replaces the entry rather than
      // pushing one, so Back leaves the queue instead of stepping through it.
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-75 R3
 */
export const Route = createFileRoute('/app/curation/proposals')({
  validateSearch,
  component: ProposalsRoute,
});
