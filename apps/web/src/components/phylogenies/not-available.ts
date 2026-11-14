import { platformCopy } from '../../lib/platform.ts';

/** The sentence for a platform with no phylogeny figures. @rfc RFC-79 R6, R7 */
export const notAvailableYet = () => `Phylogenies are not available on ${platformCopy().name} yet.`;
