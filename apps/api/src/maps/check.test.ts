import { describe, expect, it } from 'vitest';
import { checkMapsExitCode } from './check.ts';

describe('checkMapsExitCode (RFC-76 R2)', () => {
  it('is 1 when the manifest is missing, even with nothing else to report', () => {
    expect(checkMapsExitCode(false, { shown: 0, problems: [] })).toBe(1);
  });

  it('is 1 when the manifest is missing, regardless of what checkMaps reports', () => {
    // A publishing gate must not pass an empty or mistargeted copy through:
    // the next step is `rsync --delete` into the live directory.
    expect(checkMapsExitCode(false, { shown: 3, problems: [] })).toBe(1);
  });

  it('is 1 when checkMaps found a problem, manifest present', () => {
    expect(
      checkMapsExitCode(true, { shown: 0, problems: ['manifest line 2: unknown trait x'] }),
    ).toBe(1);
  });

  it('is 0 only when the manifest is present and checkMaps found nothing wrong', () => {
    expect(checkMapsExitCode(true, { shown: 2, problems: [] })).toBe(0);
  });
});
