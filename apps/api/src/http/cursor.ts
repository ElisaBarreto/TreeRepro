import { AppError } from './errors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Keyset cursor over a UUID v7 primary key (RFC-02 R8): the last id of a page,
 * base64url so clients treat it as opaque.
 * @rfc RFC-11 R6
 */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

/** @rfc RFC-11 R6 */
export function decodeCursor(token: string): string {
  const id = Buffer.from(token, 'base64url').toString('utf8');
  if (!UUID.test(id) || encodeCursor(id) !== token) {
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path: 'cursor', message: 'Invalid cursor' },
    ]);
  }
  return id;
}

const invalidCursor = () =>
  new AppError('VALIDATION_FAILED', 'Request validation failed', [
    { path: 'cursor', message: 'Invalid cursor' },
  ]);

/** A composite cursor part shaped like a UUID (reuses {@link decodeCursor}'s pattern). @rfc RFC-11 R6 */
export function isUuid(part: string): boolean {
  return UUID.test(part);
}

/** A composite cursor part made only of ASCII digits (a `bigserial` row number). @rfc RFC-11 R6 */
export function isDigits(part: string): boolean {
  return /^\d+$/.test(part);
}

/**
 * Keyset cursor over several sort columns (name then id, row_no then id):
 * the JSON array of the last row's values, base64url so clients treat it as
 * opaque. Callers compare with a row-value predicate, `(a, b) > ($1, $2)`.
 * @rfc RFC-11 R6
 */
export function encodeCompositeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/**
 * Decodes a composite cursor, optionally validating each part (one validator
 * per position, e.g. {@link isUuid} for a uuid part) — a tampered token whose
 * shape is otherwise valid JSON must still fail with 400, not reach the SQL
 * cast that would throw a raw driver error.
 * @rfc RFC-11 R6
 */
export function decodeCompositeCursor(
  token: string,
  arity: number,
  validators?: ((part: string) => boolean)[],
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== arity ||
    !parsed.every((p) => typeof p === 'string') ||
    encodeCompositeCursor(parsed) !== token
  ) {
    throw invalidCursor();
  }
  if (
    validators &&
    (validators.length !== arity || !parsed.every((p, i) => validators[i]?.(p) === true))
  ) {
    throw invalidCursor();
  }
  return parsed;
}

/**
 * The limit + 1 tail every keyset list shares: `rows` were fetched with
 * `limit + 1`; the page is the first `limit` of them and the cursor of the
 * page's last row is emitted only when a row beyond the page proved there
 * is more.
 * @rfc RFC-11 R6
 */
export function pageOf<Row>(
  rows: Row[],
  limit: number,
  cursorOf: (last: Row) => string,
): { page: Row[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { page, nextCursor: rows.length > limit && last ? cursorOf(last) : null };
}
