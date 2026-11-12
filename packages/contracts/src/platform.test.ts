import { describe, expect, it } from 'vitest';
import { PLATFORM_NAMES, PLATFORMS } from './platform.ts';

describe('RFC-14 R1 platforms', () => {
  it('lists the two platform keys and their display names', () => {
    expect(PLATFORMS).toEqual(['treerepro', 'plantrepro']);
    expect(PLATFORM_NAMES).toEqual({ treerepro: 'TreeRepro', plantrepro: 'PlantRepro' });
  });
});
