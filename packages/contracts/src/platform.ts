/** The platform keys (RFC-14 R1). @rfc RFC-14 R1 */
export const PLATFORMS = ['treerepro', 'plantrepro'] as const;

/** @rfc RFC-14 R1 */
export type Platform = (typeof PLATFORMS)[number];

/** @rfc RFC-14 R1 */
export const PLATFORM_NAMES: Record<Platform, string> = {
  treerepro: 'TreeRepro',
  plantrepro: 'PlantRepro',
};

/**
 * What each platform covers, singular (`tree species`); the copy adds the
 * plural `s` (`how trees reproduce`).
 * @rfc RFC-13 R14
 */
export const PLATFORM_SUBJECTS: Record<Platform, 'tree' | 'plant'> = {
  treerepro: 'tree',
  plantrepro: 'plant',
};
