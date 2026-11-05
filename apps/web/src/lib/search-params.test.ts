import { describe, expect, it } from 'vitest';
import { enumListParam } from './search-params.ts';

describe('RFC-13 R2 enumListParam', () => {
  const allowed = ['a', 'b', 'c'] as const;

  it('keeps the known values once, in the enum order; nothing known is undefined', () => {
    expect(enumListParam('c,a,zz,a', allowed)).toBe('a,c');
    expect(enumListParam('zz', allowed)).toBeUndefined();
    expect(enumListParam('', allowed)).toBeUndefined();
    expect(enumListParam(['a'], allowed)).toBeUndefined();
  });
});
