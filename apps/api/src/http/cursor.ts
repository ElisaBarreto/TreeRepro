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

/**
 * Keyset cursor over several sort columns (name then id, row_no then id):
 * the JSON array of the last row's values, base64url so clients treat it as
 * opaque. Callers compare with a row-value predicate, `(a, b) > ($1, $2)`.
 * @rfc RFC-11 R6
 */
export function encodeCompositeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/** @rfc RFC-11 R6 */
export function decodeCompositeCursor(token: string, arity: number): string[] {
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
  return parsed;
}
