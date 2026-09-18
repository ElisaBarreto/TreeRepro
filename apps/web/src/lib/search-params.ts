const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A trimmed search param of at most `max` characters, or `undefined` when
 * the URL carries nothing usable. A route's `validateSearch` answers every
 * key it knows, `undefined` included: an omitted key would leave the raw,
 * unvalidated value the router parsed out of the URL in its place, because a
 * child route's validated search is merged over the location's own rather
 * than replacing it.
 * @rfc RFC-13 R2
 */
export function textParam(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > max ? undefined : trimmed;
}

/** A search param that must look like a uuid to reach a control or the API. @rfc RFC-13 R2 */
export function uuidParam(value: unknown): string | undefined {
  const candidate = textParam(value, 36);
  return candidate !== undefined && UUID.test(candidate) ? candidate : undefined;
}

/** A search param that must be one of its enum's values. @rfc RFC-13 R2 */
export function enumParam<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}
