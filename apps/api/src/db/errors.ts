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

/**
 * The constraint a 23505 / 23503 / 23514 error names (postgres.js sets
 * `constraint_name`), walking wrapper causes like {@link isUniqueViolation}.
 * @rfc RFC-61 R6
 */
export function violatedConstraint(err: unknown): string | undefined {
  let cur: unknown = err;
  while (cur instanceof Error) {
    const name = (cur as { constraint_name?: unknown }).constraint_name;
    if (typeof name === 'string') return name;
    cur = cur.cause;
  }
  return undefined;
}
