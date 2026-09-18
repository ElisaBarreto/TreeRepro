import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFlag, writeFlag } from './storage.ts';

const KEY = 'treerepro.test.flag';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('RFC-73 R3 storage flags', () => {
  it('readFlag answers false for a key that was never written', () => {
    expect(readFlag(KEY)).toBe(false);
  });

  it('writeFlag(true) then readFlag answers true, and writeFlag(false) clears it back', () => {
    writeFlag(KEY, true);
    expect(readFlag(KEY)).toBe(true);
    writeFlag(KEY, false);
    expect(readFlag(KEY)).toBe(false);
  });

  it('readFlag answers false, not a throw, when localStorage.getItem itself throws (private browsing)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage is disabled');
    });
    expect(() => readFlag(KEY)).not.toThrow();
    expect(readFlag(KEY)).toBe(false);
  });

  it('writeFlag does not throw when localStorage.setItem itself throws (private browsing)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError: storage is disabled');
    });
    expect(() => writeFlag(KEY, true)).not.toThrow();
  });
});
