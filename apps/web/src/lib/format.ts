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

/** A measurement for display: up to three decimals, en-GB separators. @rfc RFC-13 R9 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 3 });
}

/** Cuts a string to `max` characters, ending with an ellipsis. @rfc RFC-13 R9 */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
