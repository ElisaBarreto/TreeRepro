import type { Dictionary } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { DICTIONARY } from '../test/dataset-fixtures.ts';
import { categoriesWithActiveTraits, traitDescription } from './dictionary.ts';

const SEED_MASS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02';
const SEED_COLOUR = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e03';
const SEED_LENGTH = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e06';

describe('RFC-62 R5 categoriesWithActiveTraits', () => {
  it('keeps the categories in dictionary order with their active traits only', () => {
    const categories = categoriesWithActiveTraits(DICTIONARY);
    expect(categories.map((c) => c.key)).toEqual(['reproductive_system', 'seed']);
    expect(categories.map((c) => c.label)).toEqual(['Reproductive system', 'Seed']);
    // seed_colour is inactive: the form must not offer it.
    expect(categories[1]?.traits.map((t) => t.id)).toEqual([SEED_MASS, SEED_LENGTH]);
  });

  it('drops a category that has no active trait left', () => {
    const [reproductive, seed] = DICTIONARY;
    if (!reproductive || !seed) throw new Error('fixture');
    const closed: Dictionary = [
      reproductive,
      { ...seed, traits: seed.traits.map((t) => ({ ...t, active: false })) },
    ];
    expect(categoriesWithActiveTraits(closed).map((c) => c.key)).toEqual(['reproductive_system']);
  });

  it('leaves the dictionary it was given untouched', () => {
    const before = JSON.stringify(DICTIONARY);
    categoriesWithActiveTraits(DICTIONARY);
    expect(JSON.stringify(DICTIONARY)).toEqual(before);
  });
});

describe('RFC-13 R11 traitDescription', () => {
  it('finds the description of a trait in any category, active or not', () => {
    expect(traitDescription(DICTIONARY, SEED_MASS)).toBe('Dry mass of one seed.');
    expect(traitDescription(DICTIONARY, SEED_COLOUR)).toBe('Colour of the mature seed coat.');
  });

  it('has nothing to say without a dictionary, for an unknown trait, or for a blank description', () => {
    expect(traitDescription(undefined, SEED_MASS)).toBeUndefined();
    expect(traitDescription(DICTIONARY, 'no-such-trait')).toBeUndefined();
    const [reproductive] = DICTIONARY;
    if (!reproductive) throw new Error('fixture');
    const blank: Dictionary = [
      { ...reproductive, traits: reproductive.traits.map((t) => ({ ...t, description: '  ' })) },
    ];
    expect(traitDescription(blank, reproductive.traits[0]?.id ?? '')).toBeUndefined();
  });
});
