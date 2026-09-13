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
 * (`12,345` for a count, `1.25 mg` for a measurement).
 * @rfc RFC-13 R9
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 3 });
}

/** Cuts a string to `max` characters, ending with an ellipsis. @rfc RFC-13 R9 */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
