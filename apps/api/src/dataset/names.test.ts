import { describe, expect, it } from 'vitest';
import { normaliseName } from './names.ts';

describe('RFC-60 R2 normaliseName', () => {
  it('trims and collapses internal whitespace to one space, keeping case', () => {
    expect(normaliseName('  Adenanthera   pavonina ')).toBe('Adenanthera pavonina');
    expect(normaliseName('Fabaceae')).toBe('Fabaceae');
    expect(normaliseName('a\t\n b')).toBe('a b');
    expect(normaliseName('   ')).toBe('');
  });
});
