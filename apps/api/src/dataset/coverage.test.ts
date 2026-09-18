import { describe, expect, it } from 'vitest';
import { percentHalfUp } from './coverage.ts';

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
