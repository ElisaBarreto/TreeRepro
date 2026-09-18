/**
 * Reads a boolean flag from `localStorage`. Private browsing, a full quota
 * or a strict CSP can make `localStorage` throw on access rather than
 * simply being absent, so the read is wrapped: any failure answers `false`,
 * the same as a key that was never set, instead of crashing the caller.
 * @rfc RFC-73 R3
 */
export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

/**
 * Writes a boolean flag to `localStorage`. A failure (private browsing, a
 * full quota) is swallowed rather than thrown: the caller's own state still
 * reflects the choice for the rest of the session, it just is not
 * remembered past it.
 * @rfc RFC-73 R3
 */
export function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // The choice then lasts for the current session only.
  }
}
