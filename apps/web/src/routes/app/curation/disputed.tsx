import { createFileRoute } from '@tanstack/react-router';
import { DisputedPage } from '../../../pages/curation/DisputedPage.tsx';

const INTENT_FILTERS = ['contest'] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * The one control of the page is a search param (plan 11b): `intent` must
 * be `contest` or nothing usable for it, same hand-rolled idiom as
 * `/app/contributions` — every key is answered explicitly rather than a
 * zod schema, so a malformed value never reaches the queue's fetch.
 */
function validateSearch(search: Record<string, unknown>): { intent?: 'contest' } {
  return { intent: oneOf(search.intent, INTENT_FILTERS) };
}

function DisputedRoute() {
  return <DisputedPage search={Route.useSearch()} />;
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-65 R10
 */
export const Route = createFileRoute('/app/curation/disputed')({
  validateSearch,
  component: DisputedRoute,
});
