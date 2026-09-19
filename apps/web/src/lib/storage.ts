/**
 * The last value written for each key, kept in memory as well as in
 * `localStorage`. Private browsing, a full quota or a strict CSP can make
 * `localStorage` throw on write, and a write that never landed cannot be
 * replayed by a later read: the caller would set a flag, remount, read
 * `false` back and watch the choice undo itself. Holding the value here
 * keeps it for the rest of the session, which is as long as a value that
 * was never persisted can honestly last.
 */
const remembered = new Map<string, boolean>();

/**
 * Reads a boolean flag from `localStorage`, falling back to the value last
 * written in this session. Private browsing, a full quota or a strict CSP
 * can make `localStorage` throw on access rather than simply being absent,
 * so the read is wrapped: any failure, or a key storage has no answer for,
 * falls back to the in-memory value and then to `false`, instead of
 * crashing the caller.
 * @rfc RFC-73 R3
 */
export function readFlag(key: string): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    // A key storage does answer for wins: it outlives the session.
    if (stored !== null) return stored === 'true';
  } catch {
    // Unreadable storage is treated like storage with nothing to say.
  }
  return remembered.get(key) ?? false;
}

/**
 * Writes a boolean flag to `localStorage`, and remembers it in memory
 * either way. A failure (private browsing, a full quota) is swallowed
 * rather than thrown: the choice still holds for the rest of the session —
 * across a remount, not just within one component's own state — it just is
 * not remembered past it.
 * @rfc RFC-73 R3
 */
export function writeFlag(key: string, value: boolean): void {
  // Set before the write, so a throwing `setItem` still leaves the value
  // behind for `readFlag`.
  remembered.set(key, value);
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // The choice then lasts for the current session only.
  }
}
