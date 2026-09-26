/**
 * The kinds of map a manifest row may name (RFC-76 R1).
 * @rfc RFC-76 R1
 */
export const MAP_KINDS = ['completeness', 'prevalence', 'mean', 'min', 'max', 'sd'] as const;
/** @rfc RFC-76 R1 */
export type MapKind = (typeof MAP_KINDS)[number];
