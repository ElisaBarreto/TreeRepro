import { ButtonLink } from '../ui/index.ts';

/**
 * The dashboard's three ways into the dataset (RFC-72 R3, spec R-18): the
 * species list, the trait dictionary and the references, each unfiltered.
 * @rfc RFC-72 R3
 */
export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-3">
      <ButtonLink to="/app/species">Browse species</ButtonLink>
      <ButtonLink to="/app/traits">Browse traits</ButtonLink>
      <ButtonLink to="/app/references">Browse references</ButtonLink>
    </nav>
  );
}
