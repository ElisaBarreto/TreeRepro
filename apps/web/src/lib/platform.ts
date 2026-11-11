import { PLATFORM_NAMES, PLATFORMS, type Platform } from '@treerepro/contracts';
import { ApiError } from '../api/client.ts';

/**
 * The platform this page is served for: a first host label of `plantrepro`
 * is PlantRepro, anything else TreeRepro (one SPA build serves both).
 * @rfc RFC-14 R7
 */
export function currentPlatform(hostname: string = window.location.hostname): Platform {
  return hostname.split('.')[0] === 'plantrepro' ? 'plantrepro' : 'treerepro';
}

/**
 * The sentence for a 403 `PLATFORM_ACCESS_DENIED` on `platform`, naming the
 * platforms the account does hold a role on; null for any other error.
 * @rfc RFC-22 R13
 */
export function platformDeniedMessage(error: unknown, platform: Platform): string | null {
  if (!(error instanceof ApiError) || error.code !== 'PLATFORM_ACCESS_DENIED') return null;
  const held = PLATFORMS.filter(
    (p) => p !== platform && (error.details ?? []).some((d) => d.message === p),
  );
  const refused = `You have no access to ${PLATFORM_NAMES[platform]}.`;
  return held.length > 0
    ? `${refused} Your account has access to ${held.map((p) => PLATFORM_NAMES[p]).join(' and ')}.`
    : refused;
}
