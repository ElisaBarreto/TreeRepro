import { ButtonLink } from '../ui/index.ts';

/**
 * The dashboard's three shortcuts into the species list, each pre-filtered
 * for what it is for (spec §4): validating carries the viewer straight to
 * their own plots sorted by what is least complete, entering data carries
 * them to what is missing there, and the third is the plain, unfiltered
 * list.
 *
 * `hasPlots` decides whether the first two carry `scope=plots`, for the
 * reason `MissingTraitsList` omits it: a viewer with no plots has nothing to
 * scope to, and `scope=plots` compiles to a `false` predicate for them
 * (RFC-33 R3), so both shortcuts would land a freshly invited contributor on
 * "No species". Unscoped, they still answer what they promise.
 * @rfc RFC-72 R3
 */
export function QuickActions({ hasPlots }: { hasPlots: boolean }) {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-3">
      <ButtonLink
        to="/app/species"
        search={hasPlots ? { scope: 'plots', sort: 'completeness' } : { sort: 'completeness' }}
      >
        Validate records
      </ButtonLink>
      <ButtonLink
        to="/app/species"
        search={hasPlots ? { traitData: 'missing', scope: 'plots' } : { traitData: 'missing' }}
        variant="secondary"
      >
        Enter new data
      </ButtonLink>
      <ButtonLink to="/app/species" variant="secondary">
        Browse species
      </ButtonLink>
    </nav>
  );
}
