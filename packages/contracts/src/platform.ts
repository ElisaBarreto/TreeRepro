/** The platform keys (RFC-14 R1). @rfc RFC-14 R1 */
export const PLATFORMS = ['treerepro', 'plantrepro'] as const;

/** @rfc RFC-14 R1 */
export type Platform = (typeof PLATFORMS)[number];

/** @rfc RFC-14 R1 */
export const PLATFORM_NAMES: Record<Platform, string> = {
  treerepro: 'TreeRepro',
  plantrepro: 'PlantRepro',
};
