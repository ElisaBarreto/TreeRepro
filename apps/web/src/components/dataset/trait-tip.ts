import type { Dictionary, TraitRef } from '@treerepro/contracts';
import { traitDescription } from '../../lib/dictionary.ts';

/**
 * What the `?` beside a trait card says (spec §7.5): the dictionary's
 * description of the trait and, for a quantitative one, the unit its records
 * are measured in — a categorical trait is measured in nothing and gains
 * nothing. The unit is added here rather than in `traitDescription`, which
 * stays a plain dictionary lookup the forms share: the unit belongs to the
 * trait the card is showing, not to the dictionary entry. No description, no
 * tip — a unit on its own explains nothing, and the card names it anyway.
 * @rfc RFC-13 R11
 */
export function traitTip(
  dictionary: Dictionary | undefined,
  trait: Pick<TraitRef, 'id' | 'unit'>,
): string | undefined {
  const description = traitDescription(dictionary, trait.id);
  if (description === undefined) return undefined;
  return trait.unit ? `${description} Measured in ${trait.unit}.` : description;
}

/**
 * The links a trait card's `?` adds beside "Learn more" — its maps and its
 * phylogeny, each only when the trait has them — and what the tip says when
 * the trait has no description but has either.
 * @rfc RFC-76 R8
 * @rfc RFC-79 R7
 */
export function traitTipLinks(key: string, hasMaps: boolean, hasPhylogeny: boolean) {
  const links = [
    ...(hasMaps ? [{ to: '/app/maps', search: { trait: key }, label: 'Maps' }] : []),
    ...(hasPhylogeny
      ? [{ to: '/app/phylogenies', search: { trait: key }, label: 'Phylogeny' }]
      : []),
  ];
  const fallback =
    hasMaps && hasPhylogeny
      ? 'Global maps and a phylogeny are available for this trait.'
      : hasMaps
        ? 'Global maps are available for this trait.'
        : hasPhylogeny
          ? 'A phylogeny is available for this trait.'
          : undefined;
  return { links, fallback };
}
