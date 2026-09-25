import { describe, expect, it } from 'vitest';
import { isValidIsbn } from './isbn.ts';

describe('RFC-61 R1, R10 isValidIsbn', () => {
  it('normalises an ISBN-13, with or without hyphens and spaces, to its 13 digits', () => {
    expect(isValidIsbn('9780306406157')).toBe('9780306406157');
    expect(isValidIsbn('978-0-306-40615-7')).toBe('9780306406157');
    expect(isValidIsbn(' 978 0 306 40615 7 ')).toBe('9780306406157');
    // Hyphens as pasted from a PDF or a publisher's page: U+2010, U+2013.
    expect(isValidIsbn('978\u20100\u2010306\u201040615\u20107')).toBe('9780306406157');
    expect(isValidIsbn('0\u2013306\u201340615\u20132')).toBe('9780306406157');
  });

  it('turns an ISBN-10 into the ISBN-13 of the same book, a final X included', () => {
    expect(isValidIsbn('0-306-40615-2')).toBe('9780306406157');
    expect(isValidIsbn('0-8044-2957-X')).toBe('9780804429573');
    expect(isValidIsbn('080442957x')).toBe('9780804429573');
  });

  it('refuses a wrong check digit, a non-book prefix, a misplaced X and any other length', () => {
    for (const bad of [
      '978-0-306-40615-8',
      '0-306-40615-3',
      '4006381333931',
      '97803064061X7',
      'X306406152',
      '030640615',
      '97803064061570',
      '',
      'ISBN 9780306406157',
      '10.1111/geb.13000',
    ]) {
      expect(isValidIsbn(bad)).toBeNull();
    }
  });
});
