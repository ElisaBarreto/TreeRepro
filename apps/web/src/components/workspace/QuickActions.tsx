import { ButtonLink } from '../ui/index.ts';

/**
 * The dashboard's three shortcuts into the species list, each pre-filtered
 * for what it is for (spec §4): validating carries the viewer straight to
 * their own plots sorted by what is least complete, entering data carries
 * them to what is missing there, and the third is the plain, unfiltered
 * list.
 * @rfc RFC-72 R3
 */
export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-3">
      <ButtonLink to="/app/species" search={{ scope: 'plots', sort: 'completeness' }}>
        Validate records
      </ButtonLink>
      <ButtonLink
        to="/app/species"
        search={{ traitData: 'missing', scope: 'plots' }}
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
