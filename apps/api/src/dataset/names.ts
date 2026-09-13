/**
 * Names are stored trimmed with internal whitespace collapsed to one space,
 * case preserved — the TypeScript twin of the importer's
 * `trim(regexp_replace(x, '\s+', ' ', 'g'))`.
 * @rfc RFC-60 R2
 */
export function normaliseName(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
