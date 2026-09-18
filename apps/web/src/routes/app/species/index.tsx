import { createFileRoute } from '@tanstack/react-router';
import { SPECIES_SORTS, SPECIES_STATUSES, TRAIT_DATA_MODES } from '@treerepro/contracts';
import {
  type SpeciesSearch,
  SpeciesSearchPage,
} from '../../../pages/dataset/SpeciesSearchPage.tsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = ['plots', 'all'] as const;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > max ? undefined : trimmed;
}

function uuid(value: unknown): string | undefined {
  const candidate = text(value, 36);
  return candidate !== undefined && UUID.test(candidate) ? candidate : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Every control of the search form is a search param (RFC-60 R6 amendment):
 * ids must look like uuids, the rest must be one of their enum's values.
 * Every key is answered, `undefined` when the URL carries nothing usable for
 * it — an omitted key would leave the raw, unvalidated value the router
 * parsed out of the URL in its place, because a child route's validated
 * search is merged over the location's own rather than replacing it. What
 * the page reads is therefore exactly this shape, so a malformed id, a value
 * outside its enum or a key nobody knows never reaches a control or the API.
 * `?unresolved=true` opens the search with the unresolved-taxa toggle on
 * (RFC-65); `scope` and `plotId` per RFC-33 R6, RFC-67 R8.
 */
function validateSearch(search: Record<string, unknown>): SpeciesSearch {
  return {
    q: text(search.q, 100),
    familyId: uuid(search.familyId),
    genusId: uuid(search.genusId),
    unresolved: search.unresolved === true || search.unresolved === 'true' ? true : undefined,
    status: oneOf(search.status, SPECIES_STATUSES),
    scope: oneOf(search.scope, SCOPES),
    plotId: uuid(search.plotId),
    categoryKey: text(search.categoryKey, 100),
    traitId: uuid(search.traitId),
    traitData: oneOf(search.traitData, TRAIT_DATA_MODES),
    sort: oneOf(search.sort, SPECIES_SORTS),
  };
}

// The page seeds its form from the validated search and pushes every change
// back into it, so the URL is the single source of truth and no remount key
// is needed: a search-only change from the sidebar (Species <-> Unresolved
// taxa) reaches the page as a new `search` prop and the form follows it.
function SpeciesSearchRoute() {
  return <SpeciesSearchPage search={Route.useSearch()} />;
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-60 R6
 */
export const Route = createFileRoute('/app/species/')({
  validateSearch,
  component: SpeciesSearchRoute,
});
