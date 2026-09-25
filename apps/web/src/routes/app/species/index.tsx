import { createFileRoute } from '@tanstack/react-router';
import {
  SPECIES_SCOPES,
  SPECIES_SORTS,
  SPECIES_STATUSES,
  TRAIT_DATA_MODES,
} from '@treerepro/contracts';
import { enumParam, textParam, uuidParam } from '../../../lib/search-params.ts';
import {
  type SpeciesSearch,
  SpeciesSearchPage,
} from '../../../pages/dataset/SpeciesSearchPage.tsx';

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
 * (RFC-65); `contested` and `unknownLevels` (RFC-60 R6, spec R-15); `scope`
 * and `plotId` per RFC-33 R6, RFC-67 R8.
 */
function validateSearch(search: Record<string, unknown>): SpeciesSearch {
  return {
    q: textParam(search.q, 100),
    familyId: uuidParam(search.familyId),
    genusId: uuidParam(search.genusId),
    unresolved: search.unresolved === true || search.unresolved === 'true' ? true : undefined,
    contested: search.contested === true || search.contested === 'true' ? true : undefined,
    unknownLevels:
      search.unknownLevels === true || search.unknownLevels === 'true' ? true : undefined,
    status: enumParam(search.status, SPECIES_STATUSES),
    scope: enumParam(search.scope, SPECIES_SCOPES),
    plotId: uuidParam(search.plotId),
    categoryKey: textParam(search.categoryKey, 100),
    traitId: uuidParam(search.traitId),
    traitData: enumParam(search.traitData, TRAIT_DATA_MODES),
    sort: enumParam(search.sort, SPECIES_SORTS),
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
