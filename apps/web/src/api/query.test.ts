import { describe, expect, it } from 'vitest';
import { withQuery } from './query.ts';

describe('withQuery', () => {
  it('appends the defined, non-empty, non-false params and leaves the path alone otherwise', () => {
    expect(withQuery('/species', { q: 'Aden', limit: 20, unresolved: true })).toBe(
      '/species?q=Aden&limit=20&unresolved=true',
    );
    expect(withQuery('/species', { q: '', cursor: undefined, unresolved: false })).toBe('/species');
  });
});
