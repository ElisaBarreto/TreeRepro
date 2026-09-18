import { describe, expect, it } from 'vitest';
import { type LabelledReference, referenceLabel } from './references.ts';

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

  // `kind` is required on `LabelledReference` (every reference the API
  // hands out carries it, per `referenceRefSchema` / `referenceSchema`), so
  // a well-typed caller cannot omit it; this only exercises the function's
  // defensive fallback if malformed data ever reaches it at runtime.
  it('falls back to the citation key if kind is ever missing at runtime', () => {
    const malformed = { citationKey: 'Smith2001' } as LabelledReference;
    expect(referenceLabel(malformed)).toBe('Smith2001');
  });
});
