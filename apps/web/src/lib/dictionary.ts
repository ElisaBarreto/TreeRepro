import type { Dictionary, Trait } from '@treerepro/contracts';

/** One broad trait category with the traits a contributor may still record. */
export interface ActiveCategory {
  key: string;
  label: string;
  traits: Trait[];
}

/**
 * The dictionary a contribution form offers: every category in dictionary
 * order with its active traits only, and no category left that has none —
 * an inactive trait takes no new records (RFC-62 R5), so a category of
 * nothing but inactive traits would be an empty choice. The dictionary the
 * query holds is left untouched; the categories are new objects.
 * @rfc RFC-62 R5
 */
export function categoriesWithActiveTraits(dictionary: Dictionary): ActiveCategory[] {
  return dictionary
    .map((category) => ({
      key: category.key,
      label: category.label,
      traits: category.traits.filter((trait) => trait.active),
    }))
    .filter((category) => category.traits.length > 0);
}

/**
 * What a trait means, for the `?` help tip beside it: the dictionary's
 * description of the trait, whatever category it sits in and whether or not
 * it is still active — a card shows the tip for a trait that already has
 * records. A description that is blank (or a dictionary that has not loaded,
 * or a trait it does not know) has nothing to say, so no tip is rendered.
 * @rfc RFC-13 R11
 * @rfc RFC-62 R5
 */
export function traitDescription(
  dictionary: Dictionary | undefined,
  traitId: string,
): string | undefined {
  const description = dictionary
    ?.flatMap((category) => category.traits)
    .find((trait) => trait.id === traitId)
    ?.description.trim();
  return description === '' ? undefined : description;
}
