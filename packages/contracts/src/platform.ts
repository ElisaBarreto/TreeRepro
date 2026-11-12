/** The platform keys (RFC-14 R1). @rfc RFC-14 R1 */
export const PLATFORMS = ['treerepro', 'plantrepro'] as const;

/** @rfc RFC-14 R1 */
export type Platform = (typeof PLATFORMS)[number];

/** @rfc RFC-14 R1 */
export const PLATFORM_NAMES: Record<Platform, string> = {
  treerepro: 'TreeRepro',
  plantrepro: 'PlantRepro',
};

/** A species' plant type; the list may grow (RFC-60 R1). @rfc RFC-60 R1 */
export const PLANT_TYPES = ['tree', 'not_tree'] as const;

/** @rfc RFC-60 R1 */
export type PlantType = (typeof PLANT_TYPES)[number];

/** @rfc RFC-60 R1 */
export const PLANT_TYPE_LABELS: Record<PlantType, string> = {
  tree: 'Tree',
  not_tree: 'Not a tree',
};

/** Whether a `records.review` holder has reviewed the plant type (RFC-60 R1). @rfc RFC-60 R1 */
export const PLANT_TYPE_STATUSES = ['proposed', 'reviewed'] as const;

/** @rfc RFC-60 R1 */
export type PlantTypeStatus = (typeof PLANT_TYPE_STATUSES)[number];

/**
 * The message of the 409 `SPECIES_NAME_TAKEN` that refuses a name a species
 * hidden on TreeRepro holds; the web app shows it as it is (RFC-60 R13).
 * @rfc RFC-60 R13
 */
export const HIDDEN_SPECIES_NAME_MESSAGE =
  'This species already exists, but it is not classified as a tree on TreeRepro. A manager can review its type.';

/**
 * What each platform covers, singular (`tree species`); the copy adds the
 * plural `s` (`how trees reproduce`).
 * @rfc RFC-13 R14
 */
export const PLATFORM_SUBJECTS: Record<Platform, 'tree' | 'plant'> = {
  treerepro: 'tree',
  plantrepro: 'plant',
};
