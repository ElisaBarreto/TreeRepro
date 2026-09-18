import { createFileRoute } from '@tanstack/react-router';
import {
  CONTRIBUTION_KINDS,
  RECORD_INTENTS,
  REVIEW_STATUSES,
  type RecordIntent,
  type ReviewStatus,
} from '@treerepro/contracts';
import { NoPermission } from '../../components/shell/NoPermission.tsx';
import { hasPermission, useMe } from '../../lib/session.ts';
import {
  ContributionsPage,
  type ContributionsSearch,
} from '../../pages/workspace/ContributionsPage.tsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function uuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function day(value: unknown): string | undefined {
  return typeof value === 'string' && ISO_DAY.test(value) ? value : undefined;
}

const INTENT_FILTERS: readonly (RecordIntent | 'none')[] = [...RECORD_INTENTS, 'none'];

/**
 * Every control of the page is a search param (RFC-71 R1): ids must look
 * like uuids, dates like `YYYY-MM-DD`, the rest must be one of their enum's
 * values. Every key is answered, `undefined` when the URL carries nothing
 * usable for it — an omitted key would leave the raw, unvalidated value the
 * router parsed out of the URL in its place, because a child route's
 * validated search is merged over the location's own rather than replacing
 * it. What the page reads is therefore exactly this shape, so a malformed id
 * or a value outside its enum never reaches a control or the API.
 */
function validateSearch(search: Record<string, unknown>): ContributionsSearch {
  return {
    kind: oneOf(search.kind, CONTRIBUTION_KINDS),
    userId: uuid(search.userId),
    traitId: uuid(search.traitId),
    speciesId: uuid(search.speciesId),
    review: oneOf<ReviewStatus>(search.review, REVIEW_STATUSES),
    intent: oneOf(search.intent, INTENT_FILTERS),
    from: day(search.from),
    to: day(search.to),
  };
}

// The permissions are checked here, above the page, so neither list nor
// summary is even requested by a viewer who may not have them; the API
// checks them again (RFC-32).
function ContributionsRoute() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!hasPermission(me, 'dataset.read')) return <NoPermission />;
  if (search.userId !== undefined && !hasPermission(me, 'contributions.read')) {
    return <NoPermission />;
  }
  return (
    <ContributionsPage
      search={search}
      // One screen: changing a filter replaces the entry rather than pushing
      // one, so Back leaves the page instead of stepping through every
      // filter tried.
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}

/**
 * @rfc RFC-13 R2, R3
 * @rfc RFC-71 R1, R5
 */
export const Route = createFileRoute('/app/contributions')({
  validateSearch,
  component: ContributionsRoute,
});
