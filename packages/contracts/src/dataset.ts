/** @rfc RFC-60 R1, R3 */
export const NAME_SOURCES = ['wcvp', 'gbif', 'original'] as const;
export type NameSource = (typeof NAME_SOURCES)[number];

/** @rfc RFC-62 R1 */
export const TRAIT_VALUE_TYPES = ['categorical', 'quantitative'] as const;
export type TraitValueType = (typeof TRAIT_VALUE_TYPES)[number];
