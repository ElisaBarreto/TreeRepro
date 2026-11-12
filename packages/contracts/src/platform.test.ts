import { describe, expect, it } from 'vitest';
import {
  PLANT_TYPE_LABELS,
  PLANT_TYPE_STATUSES,
  PLANT_TYPES,
  PLATFORM_NAMES,
  PLATFORMS,
} from './platform.ts';

describe('RFC-14 R1 platforms', () => {
  it('lists the two platform keys and their display names', () => {
    expect(PLATFORMS).toEqual(['treerepro', 'plantrepro']);
    expect(PLATFORM_NAMES).toEqual({ treerepro: 'TreeRepro', plantrepro: 'PlantRepro' });
  });
});

describe('RFC-60 R1 plant types', () => {
  it('lists the plant types, their labels and the review statuses', () => {
    expect(PLANT_TYPES).toEqual(['tree', 'not_tree']);
    expect(PLANT_TYPE_LABELS).toEqual({ tree: 'Tree', not_tree: 'Not a tree' });
    expect(PLANT_TYPE_STATUSES).toEqual(['proposed', 'reviewed']);
  });
});

describe('RFC-13 R14 platform subjects', () => {
  it('names what each platform covers', async () => {
    const { PLATFORM_SUBJECTS } = await import('./platform.ts');
    expect(PLATFORM_SUBJECTS).toEqual({ treerepro: 'tree', plantrepro: 'plant' });
  });
});
