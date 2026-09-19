import { describe, expect, it } from 'vitest';
import {
  articleKind,
  formatDateTime,
  formatNumber,
  humaniseKey,
  isoDate,
  truncate,
} from './format.ts';

describe('RFC-13 R9 format helpers', () => {
  it('humaniseKey replaces every underscore with a space', () => {
    expect(humaniseKey('sexual_system')).toBe('sexual system');
    expect(humaniseKey('seed_mass_per_fruit')).toBe('seed mass per fruit');
  });

  it('isoDate keeps the calendar date of a timestamp', () => {
    expect(isoDate('2026-09-01T23:59:00.000Z')).toBe('2026-09-01');
  });

  it('formatDateTime keeps the UTC date and the time of day to the minute', () => {
    expect(formatDateTime('2026-09-13T10:15:30.000Z')).toBe('2026-09-13 10:15');
    expect(formatDateTime('2026-09-01T23:59:59.999Z')).toBe('2026-09-01 23:59');
  });

  it('formatNumber shows integers plainly and at most three decimals', () => {
    expect(formatNumber(3)).toBe('3');
    expect(formatNumber(1.25)).toBe('1.25');
    expect(formatNumber(0.123456)).toBe('0.123');
    expect(formatNumber(12345.5)).toBe('12,345.5');
  });

  it('formatNumber separates thousands in a count', () => {
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatNumber(0)).toBe('0');
  });

  it('formatNumber falls back to three significant digits for a non-zero value below 0.001, so a measurement never renders as a false 0', () => {
    expect(formatNumber(0.0004)).toBe('0.0004');
    expect(formatNumber(0.000123)).toBe('0.000123');
    expect(formatNumber(0.00000071)).toBe('0.00000071');
    // Zero itself is not a small non-zero value: it stays exactly 0.
    expect(formatNumber(0)).toBe('0');
    // Negatives mirror positives instead of the misleading -0 the default path would give.
    expect(formatNumber(-0.0004)).toBe('-0.0004');
  });

  it('truncate leaves short text alone and ends long text with an ellipsis at the limit', () => {
    expect(truncate('short', 80)).toBe('short');
    const long = 'a'.repeat(100);
    expect(truncate(long, 80)).toHaveLength(80);
    expect(truncate(long, 80).endsWith('…')).toBe(true);
  });

  it('articleKind tells a DOI, a numeric index and a full citation apart from an ordinary key', () => {
    expect(articleKind('10.1111/geb.13640')).toBe('DOI');
    expect(articleKind('10.1000/jte.2001.1')).toBe('DOI');
    // A long DOI is still a DOI, not a full citation.
    expect(articleKind(`10.1234/${'a'.repeat(90)}`)).toBe('DOI');
    expect(articleKind('42')).toBe('numeric index');
    expect(articleKind('3; 4, 12')).toBe('numeric index');
    expect(articleKind(`Smith, J. (2001). ${'x'.repeat(80)}`)).toBe('full citation');
    expect(articleKind('Smith2001')).toBeNull();
    expect(articleKind('Alfaro_et_al_2023_GEB')).toBeNull();
    // A DOI registrant has at least four digits; eighty characters is still a key.
    expect(articleKind('10.12/short')).toBeNull();
    expect(articleKind('x'.repeat(80))).toBeNull();
  });
});
