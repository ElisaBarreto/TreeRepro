import { describe, expect, it } from 'vitest';
import { referenceLabel } from './references.ts';

const OBSERVATION_KEY = 'personal-observation:018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';

describe('RFC-61 R4 referenceLabel', () => {
  it('names a publication by its citation key', () => {
    expect(referenceLabel({ citationKey: 'Renner2014', kind: 'publication' })).toBe('Renner2014');
  });

  it('names a personal observation after its observer, never by its key', () => {
    const label = referenceLabel({
      citationKey: OBSERVATION_KEY,
      kind: 'personal_observation',
      observer: { name: 'Ada' },
    });
    expect(label).toBe('Personal observation (Ada)');
    expect(label).not.toContain(OBSERVATION_KEY);
  });

  it('names a personal observation alone when the viewer cannot see the observer', () => {
    expect(referenceLabel({ citationKey: OBSERVATION_KEY, kind: 'personal_observation' })).toBe(
      'Personal observation',
    );
    expect(
      referenceLabel({
        citationKey: OBSERVATION_KEY,
        kind: 'personal_observation',
        observer: null,
      }),
    ).toBe('Personal observation');
  });

  it('falls back to the citation key for a reference that carries no kind', () => {
    expect(referenceLabel({ citationKey: 'Smith2001' })).toBe('Smith2001');
  });
});
