/**
 * `YYYY-MM-DD HH:MM` in UTC, read straight off the ISO 8601 string the API
 * sends (RFC-11 R9), so a value renders the same in every browser and in tests.
 * @rfc RFC-13 R5
 */
export function formatDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

const COUNT = new Intl.NumberFormat('en-US');

/** Integer with thousands separators (`12,345`). @rfc RFC-13 R5 */
export function formatCount(value: number): string {
  return COUNT.format(value);
}
