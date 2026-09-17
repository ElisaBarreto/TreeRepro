import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normaliseDoi } from './doi.ts';

describe('RFC-80 R1 normaliseDoi property tests', () => {
  const prefixes = ['', 'doi:', 'DOI:', 'https://doi.org/', 'http://dx.doi.org/'];
  const suffixArb = fc.stringMatching(/^[A-Za-z0-9._;()/-]{1,50}$/);
  const registrantArb = fc.integer({ min: 1000, max: 999999999 }).map(String);

  it('strips known prefixes and lowercases a valid DOI', () => {
    fc.assert(
      fc.property(fc.constantFrom(...prefixes), registrantArb, suffixArb, (prefix, reg, suffix) => {
        const canonical = `10.${reg}/${suffix}`;
        const input = prefix + canonical;
        const result = normaliseDoi(input);
        expect(result).toBe(canonical.toLowerCase());
      }),
    );
  });

  it('is idempotent on its own output', () => {
    fc.assert(
      fc.property(registrantArb, suffixArb, (reg, suffix) => {
        const canonical = `10.${reg}/${suffix}`.toLowerCase();
        expect(normaliseDoi(canonical)).toBe(canonical);
      }),
    );
  });
});
