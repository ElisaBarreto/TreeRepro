import { PLATFORM_NAMES, PLATFORM_SUBJECTS, type Platform } from '@treerepro/contracts';

/**
 * The platform of a hostname: a first label of `plantrepro` is PlantRepro,
 * anything else TreeRepro. `public/platform.js` applies the same rule before
 * first paint; a test runs both over one table.
 * @rfc RFC-13 R14
 */
export function currentPlatform(hostname: string = window.location.hostname): Platform {
  return hostname.split('.')[0]?.toLowerCase() === 'plantrepro' ? 'plantrepro' : 'treerepro';
}

/** The current platform's display name and subject (`tree`, `plant`). @rfc RFC-13 R14 */
export function platformCopy(platform: Platform = currentPlatform()) {
  return { platform, name: PLATFORM_NAMES[platform], subject: PLATFORM_SUBJECTS[platform] };
}
