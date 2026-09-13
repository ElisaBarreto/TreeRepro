export type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * The path with its query string: `undefined`, `''` and `false` are left out
 * (an unchecked filter sends nothing), `true` is sent as `'true'` — the
 * form the API's boolean query params take (RFC-60 R6).
 * @rfc RFC-11 R6
 * @rfc RFC-60 R6
 */
export function withQuery(path: string, params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
