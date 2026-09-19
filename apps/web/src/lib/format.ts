import type { NameSource, NameType, TraitValueType } from '@treerepro/contracts';

/** How each species name source reads (RFC-60 R3); the wire code stays the value. @rfc RFC-13 R9 */
export const NAME_SOURCE_LABELS: Record<NameSource, string> = {
  wcvp: 'WCVP',
  gbif: 'GBIF',
  original: 'Original source',
};

/** How each alternative-name type reads in `AddNameDialog`'s Type select (RFC-60 R4). @rfc RFC-13 R9 */
export const NAME_TYPE_LABELS: Record<NameType, string> = {
  gbif: 'GBIF name',
  synonym: 'Synonym',
  common: 'Common name',
};

/** How each trait value type reads (RFC-62 R2); the wire code stays the value. @rfc RFC-13 R9 */
export const TRAIT_VALUE_TYPE_LABELS: Record<TraitValueType, string> = {
  categorical: 'Categorical',
  quantitative: 'Quantitative',
};

/**
 * A dictionary key as words: `sexual_system` → `sexual system`. The key
 * itself stays as the dictionary spells it (RFC-62 R2); only the display changes.
 * @rfc RFC-13 R9
 */
export function humaniseKey(key: string): string {
  return key.replaceAll('_', ' ');
}

/**
 * The calendar date of an ISO timestamp (`2026-09-01`), the same in every
 * locale and time zone, so lists sort visually and tests stay deterministic.
 * @rfc RFC-13 R9
 */
export function isoDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * `YYYY-MM-DD HH:MM` in UTC, read straight off the ISO 8601 string the API
 * sends (RFC-11 R9): the calendar date of `isoDate` plus the time of day, for
 * events where the hour matters (an import batch starting and finishing).
 * @rfc RFC-13 R9
 */
export function formatDateTime(timestamp: string): string {
  return `${isoDate(timestamp)} ${timestamp.slice(11, 16)}`;
}

/**
 * A number for display with thousands separators and at most three decimals
 * (`12,345` for a count, `1.25 mg` for a measurement). A non-zero value whose
 * absolute value is below `0.001` would round to `0` under that rule — a
 * false value, not a rounded one, since the measurement is real but too small
 * to survive three decimal places — so that case instead shows three
 * significant digits (`0.0004`, `0.000123`, `-0.0004`). Zero itself stays `0`.
 * @rfc RFC-13 R9
 */
export function formatNumber(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.001) {
    return value.toLocaleString('en-GB', { maximumSignificantDigits: 3 });
  }
  return value.toLocaleString('en-GB', { maximumFractionDigits: 3 });
}

/** Cuts a string to `max` characters, ending with an ellipsis. @rfc RFC-13 R9 */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type ArticleKind = 'DOI' | 'numeric index' | 'full citation';

/**
 * How a citation key reads, for a hint next to it: a DOI (`10.1234/…`), a
 * bare numeric index the compilation left in place of a name (`42`, `3; 4`),
 * or a full citation pasted as the key (over 80 characters). An ordinary key
 * (`Smith2001`, `Alfaro_et_al_2023_GEB`) gets `null`. Presentation only: the
 * key itself stays the reference's identity (RFC-61 R2).
 * @rfc RFC-13 R9
 */
export function articleKind(key: string): ArticleKind | null {
  if (/^10\.\d{4,}\//.test(key)) return 'DOI';
  if (/^[\d,;\s]+$/.test(key)) return 'numeric index';
  if (key.length > 80) return 'full citation';
  return null;
}
