// The ISBN-13 check digit of twelve digits: weights 1 and 3 alternating, the
// digit that brings the sum to a multiple of ten.
function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/**
 * An ISBN as typed — ISBN-10 or ISBN-13, hyphens and spaces allowed, a final
 * `X` (either case) standing for 10 in an ISBN-10 — normalised to its 13
 * digits, or `null` when it is not one: another length or character, a check
 * digit that does not match, or thirteen digits outside the 978/979 book
 * prefixes. An ISBN-10 becomes 978, its first nine digits and a new check
 * digit, so both forms of one book normalise alike. No lookup: a well-formed
 * ISBN is taken as given (RFC-61 R10).
 * @rfc RFC-61 R1, R10
 */
export function isValidIsbn(input: string): string | null {
  const s = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) sum += (10 - i) * (s[i] === 'X' ? 10 : Number(s[i]));
    if (sum % 11 !== 0) return null;
    const first12 = `978${s.slice(0, 9)}`;
    return first12 + isbn13CheckDigit(first12);
  }
  if (/^97[89]\d{10}$/.test(s)) return isbn13CheckDigit(s.slice(0, 12)) === s[12] ? s : null;
  return null;
}
