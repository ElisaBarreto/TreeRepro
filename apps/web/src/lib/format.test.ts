import { describe, expect, it } from 'vitest';
import { formatDateTime, formatNumber, humaniseKey, isoDate, truncate } from './format.ts';

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

  it('truncate leaves short text alone and ends long text with an ellipsis at the limit', () => {
    expect(truncate('short', 80)).toBe('short');
    const long = 'a'.repeat(100);
    expect(truncate(long, 80)).toHaveLength(80);
    expect(truncate(long, 80).endsWith('…')).toBe(true);
  });
});
