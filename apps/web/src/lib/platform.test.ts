import { describe, expect, it } from 'vitest';
import source from '../../public/platform.js?raw';
import { ApiError } from '../api/client.ts';
import { currentPlatform, platformDeniedMessage } from './platform.ts';

const TABLE = [
  ['localhost', 'treerepro'],
  ['treerepro.elisabarreto.com.br', 'treerepro'],
  ['plantrepro.localhost', 'plantrepro'],
  ['plantrepro.elisabarreto.com.br', 'plantrepro'],
  ['PlantRepro.Localhost', 'plantrepro'],
  ['www.plantrepro.example', 'treerepro'],
  ['plantreproduction.example', 'treerepro'],
  ['127.0.0.1', 'treerepro'],
] as const;

/** Runs `public/platform.js` against a stand-in document at `hostname`. */
function runScript(hostname: string) {
  const icon = { href: '/favicon.svg' };
  const doc = {
    title: 'TreeRepro',
    documentElement: { dataset: {} as Record<string, string> },
    querySelector: () => icon,
  };
  new Function('location', 'document', source)({ hostname }, doc);
  return { platform: doc.documentElement.dataset.platform, title: doc.title, icon: icon.href };
}

describe('RFC-13 R14 platform of the hostname', () => {
  it.each(TABLE)('%s is %s', (hostname, platform) => {
    expect(currentPlatform(hostname)).toBe(platform);
  });

  it.each(TABLE)('platform.js agrees on %s', (hostname, platform) => {
    expect(runScript(hostname).platform).toBe(platform);
  });

  it('platform.js brands the title and favicon on PlantRepro only', () => {
    expect(runScript('plantrepro.localhost')).toEqual({
      platform: 'plantrepro',
      title: 'PlantRepro',
      icon: '/favicon-plantrepro.svg',
    });
    expect(runScript('localhost')).toEqual({
      platform: 'treerepro',
      title: 'TreeRepro',
      icon: '/favicon.svg',
    });
  });

  it('defaults to the window hostname (jsdom: localhost)', () => {
    expect(currentPlatform()).toBe('treerepro');
  });
});

describe('RFC-22 R13 platformDeniedMessage', () => {
  const denied = (held: string[]) =>
    new ApiError(
      403,
      'PLATFORM_ACCESS_DENIED',
      'x',
      held.map((message) => ({ path: 'platforms', message })),
    );

  it('names the platform refused and the other one the user holds', () => {
    expect(platformDeniedMessage(denied(['treerepro']), 'plantrepro')).toBe(
      'You have no access to PlantRepro. Your account has access to TreeRepro.',
    );
    expect(platformDeniedMessage(denied([]), 'treerepro')).toBe('You have no access to TreeRepro.');
  });

  it('is null for any other error', () => {
    expect(
      platformDeniedMessage(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'), 'treerepro'),
    ).toBeNull();
    expect(platformDeniedMessage(new Error('x'), 'treerepro')).toBeNull();
  });
});
