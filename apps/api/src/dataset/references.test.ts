import { describe, expect, it } from 'vitest';
import type { ReferenceRow } from '../db/schema/references.ts';
import { toReference } from './references.ts';

const baseRow: ReferenceRow = {
  id: '00000000-0000-7000-8000-000000000000',
  citationKey: 'Key2023',
  title: null,
  authors: null,
  year: null,
  journal: null,
  doi: null,
  url: null,
  createdAt: new Date('2023-01-01T00:00:00Z'),
  createdBy: null,
  primaryCount: 0,
  secondaryCount: 0,
  usageCount: 0,
  kind: 'publication',
  observerUserId: null,
  shortCitation: null,
  fullCitation: null,
};

describe('RFC-61 R1, R4 toReference', () => {
  it('carries the row shortCitation and fullCitation through', () => {
    const row: ReferenceRow = {
      ...baseRow,
      shortCitation: 'Alfaro (2023)',
      fullCitation: 'Alfaro, A. (2023). Seed size. Global Ecology. https://doi.org/10.1/x',
    };
    const ref = toReference(row);
    expect(ref.shortCitation).toBe('Alfaro (2023)');
    expect(ref.fullCitation).toBe(
      'Alfaro, A. (2023). Seed size. Global Ecology. https://doi.org/10.1/x',
    );
  });

  it('carries null citations through unchanged, not a hardcoded default', () => {
    const ref = toReference(baseRow);
    expect(ref.shortCitation).toBeNull();
    expect(ref.fullCitation).toBeNull();
  });
});
