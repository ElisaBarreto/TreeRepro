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
