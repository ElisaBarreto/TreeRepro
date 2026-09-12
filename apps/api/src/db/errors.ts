const SQLSTATE = /^[0-9A-Z]{5}$/;

/** Wrapper errors may carry their own `code` (e.g. `ERR_QUERY`); only a SQLSTATE ends the walk. */
function sqlState(err: unknown): string | undefined {
  let cur: unknown = err;
  while (cur instanceof Error) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && SQLSTATE.test(code)) return code;
    cur = cur.cause;
  }
  return undefined;
}

/** @rfc RFC-20 R3 */
export function isUniqueViolation(err: unknown): boolean {
  return sqlState(err) === '23505';
}

/** @rfc RFC-20 R9 */
export function isForeignKeyViolation(err: unknown): boolean {
  return sqlState(err) === '23503';
}

/** @rfc RFC-20 R1 */
export function isCheckViolation(err: unknown): boolean {
  return sqlState(err) === '23514';
}
