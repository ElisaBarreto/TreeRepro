import { describe, expect, it } from 'vitest';
import type { ReferenceRow } from '../db/schema/references.ts';
import { fullCitationFrom, toReference } from './references.ts';

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
  isbn: null,
};

describe('RFC-61 R1, R4 toReference', () => {
  it('RFC-61 R10 carries the ISBN of a book through', () => {
    const ref = toReference({ ...baseRow, kind: 'book', isbn: '9780306406157' });
    expect(ref).toMatchObject({ kind: 'book', isbn: '9780306406157' });
    expect(toReference(baseRow).isbn).toBeNull();
  });

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

describe('RFC-61 R8 fullCitationFrom joins only the parts Crossref returned', () => {
  it('joins authors, year, title, journal and the DOI url when all are present', () => {
    expect(
      fullCitationFrom(
        {
          title: 'Seed size',
          authors: 'Alfaro, A; Diaz, B',
          year: 2023,
          journal: 'Global Ecology',
        },
        '10.1111/geb.13000',
      ),
    ).toBe(
      'Alfaro, A; Diaz, B (2023). Seed size. Global Ecology. https://doi.org/10.1111/geb.13000',
    );
  });

  it('drops a missing journal without leaving a stray ". ." before the DOI url', () => {
    expect(
      fullCitationFrom(
        { title: 'Title', authors: 'Smith, J', year: 2020, journal: null },
        '10.1111/x',
      ),
    ).toBe('Smith, J (2020). Title. https://doi.org/10.1111/x');
  });

  it('drops missing authors without a leading separator', () => {
    expect(
      fullCitationFrom(
        { title: 'Title', authors: null, year: 2020, journal: 'Journal' },
        '10.1111/x',
      ),
    ).toBe('(2020). Title. Journal. https://doi.org/10.1111/x');
  });

  it('drops a missing year without leaving a bare "()"', () => {
    expect(
      fullCitationFrom(
        { title: 'Title', authors: 'Smith, J', year: null, journal: 'Journal' },
        '10.1111/x',
      ),
    ).toBe('Smith, J. Title. Journal. https://doi.org/10.1111/x');
  });

  it('drops both authors and year, leaving title as the first part', () => {
    expect(
      fullCitationFrom(
        { title: 'Title', authors: null, year: null, journal: 'Journal' },
        '10.1111/x',
      ),
    ).toBe('Title. Journal. https://doi.org/10.1111/x');
  });

  it('drops authors, year and journal together, leaving only title and the DOI url', () => {
    expect(
      fullCitationFrom({ title: 'Title', authors: null, year: null, journal: null }, '10.1111/x'),
    ).toBe('Title. https://doi.org/10.1111/x');
  });
});
