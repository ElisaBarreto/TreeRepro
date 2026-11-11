import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { currentPlatform, platformDeniedMessage } from './platform.ts';

describe('RFC-14 R7 currentPlatform', () => {
  it('is PlantRepro when the first label is plantrepro, TreeRepro otherwise', () => {
    expect(currentPlatform('plantrepro.elisabarreto.com.br')).toBe('plantrepro');
    expect(currentPlatform('plantrepro.localhost')).toBe('plantrepro');
    expect(currentPlatform('treerepro.elisabarreto.com.br')).toBe('treerepro');
    expect(currentPlatform('localhost')).toBe('treerepro');
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
