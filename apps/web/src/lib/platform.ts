import { PLATFORM_NAMES, PLATFORM_SUBJECTS, PLATFORMS, type Platform } from '@treerepro/contracts';
import { ApiError } from '../api/client.ts';

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

/**
 * Help text for the reader's platform: `{platform}`, `{subject}` and
 * `{subjects}` become its name, subject and plural subject.
 * @rfc RFC-73 R9
 */
export function forPlatform(text: string, platform: Platform = currentPlatform()): string {
  const { name, subject } = platformCopy(platform);
  const words: Record<string, string> = { platform: name, subject, subjects: `${subject}s` };
  return text.replace(/\{(platform|subjects?)\}/g, (_, key: string) => words[key] ?? '');
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
