import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL, projectDescription } from './project.ts';

const COUNTS = {
  primaryReferenceCount: 38,
  secondaryReferenceCount: 12,
  recordCount: 980,
  speciesCount: 120,
};

describe('RFC-72 R3 projectDescription', () => {
  it('reproduces the fixed copy character for character with the counts substituted', () => {
    expect(projectDescription(COUNTS)).toBe(
      'TreeRepro is a collective data assembly of reproductive trait data for trees, ' +
        'covering traits across all reproductive stages — flower, fruits, and seeds. ' +
        'Its core data comes from open-source papers and data repositories spanning ' +
        '38 primary references, 12 secondary references and 980 records over 120 species. ' +
        'It is shared here with a community of specialists to fill gaps and ' +
        'validate existing records. ' +
        'For questions, contact elisabpereira@gmail.com.',
    );
  });

  it('substitutes a different set of counts the same way', () => {
    expect(
      projectDescription({
        primaryReferenceCount: 1,
        secondaryReferenceCount: 2,
        recordCount: 3,
        speciesCount: 4,
      }),
    ).toContain(
      'spanning 1 primary references, 2 secondary references and 3 records over 4 species.',
    );
  });

  it('CONTACT_EMAIL is the address embedded in the paragraph', () => {
    expect(
      projectDescription({
        primaryReferenceCount: 0,
        secondaryReferenceCount: 0,
        recordCount: 0,
        speciesCount: 0,
      }),
    ).toContain(CONTACT_EMAIL);
  });

  it('RFC-13 R9 writes the counts with thousands separators', () => {
    expect(
      projectDescription({
        primaryReferenceCount: 1715,
        secondaryReferenceCount: 125,
        recordCount: 14534,
        speciesCount: 10316,
      }),
    ).toContain(
      'spanning 1,715 primary references, 125 secondary references and 14,534 records over 10,316 species.',
    );
  });
});
