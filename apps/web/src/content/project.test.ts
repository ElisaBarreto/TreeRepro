import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL, projectDescription } from './project.ts';

describe('RFC-72 R3 projectDescription', () => {
  it('reproduces the fixed copy character for character with the counts substituted', () => {
    expect(projectDescription({ referenceCount: 45, recordCount: 980, speciesCount: 120 })).toBe(
      'TreeRepro is a collective data assembly of reproductive trait data for trees, ' +
        'covering traits across all reproductive stages — flower, fruits, and seeds. ' +
        'Its core data comes from open-source papers and data repositories spanning ' +
        '45 references and 980 records over 120 species. ' +
        'It is shared here with a community of specialist scientists to fill gaps and ' +
        'validate existing records. ' +
        'For questions, contact elisabpereira@gmail.com.',
    );
  });

  it('substitutes a different set of counts the same way', () => {
    expect(projectDescription({ referenceCount: 1, recordCount: 2, speciesCount: 3 })).toContain(
      'spanning 1 references and 2 records over 3 species.',
    );
  });

  it('CONTACT_EMAIL is the address embedded in the paragraph', () => {
    expect(projectDescription({ referenceCount: 0, recordCount: 0, speciesCount: 0 })).toContain(
      CONTACT_EMAIL,
    );
  });
});
