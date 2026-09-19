import type { CoverageTraitRow } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { percentHalfUp, rankCoverageTraits } from './coverage.ts';

/** The exact half-up percentage of a rational, in integer arithmetic that cannot drift. */
function exact(part: number, whole: number): number {
  const p = BigInt(part);
  const w = BigInt(whole);
  return Number((p * 200n + w) / (w * 2n));
}

describe('RFC-69 R5 percentHalfUp', () => {
  it('rounds a half up rather than to the nearest even or down', () => {
    expect(percentHalfUp(1, 8)).toBe(13); // 12.5
    expect(percentHalfUp(3, 8)).toBe(38); // 37.5
    expect(percentHalfUp(5, 8)).toBe(63); // 62.5
    expect(percentHalfUp(1, 200)).toBe(1); // 0.5
    expect(percentHalfUp(3, 200)).toBe(2); // 1.5 — Math.round to even would give 2 as well
    expect(percentHalfUp(1, 3)).toBe(33);
    expect(percentHalfUp(2, 3)).toBe(67);
  });

  it('answers 0 on an empty grid and 100 on a full one', () => {
    expect(percentHalfUp(0, 0)).toBe(0);
    expect(percentHalfUp(0, 12)).toBe(0);
    expect(percentHalfUp(7, 7)).toBe(100);
  });

  it('never drifts off the exact rational answer', () => {
    for (let whole = 1; whole <= 200; whole++) {
      for (let part = 0; part <= whole; part++) {
        expect([part, whole, percentHalfUp(part, whole)]).toEqual([
          part,
          whole,
          exact(part, whole),
        ]);
      }
    }
  });

  it('stays exact on a grid of millions of cells', () => {
    expect(percentHalfUp(1_500_000, 12_000_000)).toBe(13); // 12.5
    expect(percentHalfUp(4_321_098, 9_876_543)).toBe(exact(4_321_098, 9_876_543));
  });
});

/** A `byTrait` row over a four-species grid, with RFC-69 R5's percentages. */
const traitRow = (key: string, withData: number, accepted: number): CoverageTraitRow => ({
  trait: {
    id: `00000000-0000-0000-0000-0000000000${key}`,
    key,
    valueType: 'categorical',
    unit: null,
  },
  category: { key: 'cat', label: 'Category' },
  species: withData,
  cells: 4,
  withData,
  accepted,
  percentWithData: percentHalfUp(withData, 4),
  percentAccepted: percentHalfUp(accepted, 4),
});

describe('RFC-69 R7 rankCoverageTraits', () => {
  const full = traitRow('01', 4, 4);
  const half = traitRow('02', 2, 1);
  const empty = traitRow('03', 0, 0);

  it('puts the trait the most species lack first in missing mode', () => {
    expect(rankCoverageTraits([full, half, empty], 'missing').map((r) => r.trait.key)).toEqual([
      '03',
      '02',
      '01',
    ]);
  });

  it('puts the lowest accepted share first in least_accepted mode, not the emptiest', () => {
    // `empty` and `half` both rank above `full` here, but the two modes
    // disagree on their order: `half` has data for two species of four and one
    // accepted pair, so it is less complete than `full` and more accepted than
    // `empty`.
    const some = traitRow('04', 4, 2);
    expect(
      rankCoverageTraits([full, some, half, empty], 'least_accepted').map((r) => r.trait.key),
    ).toEqual(['03', '02', '04', '01']);
    expect(
      rankCoverageTraits([full, some, half, empty], 'missing').map((r) => r.trait.key),
    ).toEqual(['03', '02', '01', '04']);
  });

  it('keeps the order it was given between equals and leaves the input alone', () => {
    const tied = [traitRow('05', 1, 0), traitRow('06', 1, 0), traitRow('07', 1, 0)];
    const input = [...tied];
    expect(rankCoverageTraits(input, 'missing').map((r) => r.trait.key)).toEqual([
      '05',
      '06',
      '07',
    ]);
    expect(rankCoverageTraits(input, 'least_accepted').map((r) => r.trait.key)).toEqual([
      '05',
      '06',
      '07',
    ]);
    expect(input).toEqual(tied);
  });
});
