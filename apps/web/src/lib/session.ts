import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import type { MeResponse, PermissionKey } from '@treerepro/contracts';
import { fetchMe } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';

/** @rfc RFC-13 R2 */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** What the router shares with every route's `beforeLoad`. @rfc RFC-13 R2 */
export interface RouterContext {
  queryClient: QueryClient;
}

/** @rfc RFC-13 R2 */
export const meQueryOptions = queryOptions({
  queryKey: ME_QUERY_KEY,
  queryFn: fetchMe,
  retry: false,
  staleTime: 60_000,
});

/**
 * The session resolved by the `/app` layout. Throws when rendered outside it:
 * pages under `/app` never see an empty session.
 * @rfc RFC-13 R2
 */
export function useMe(): MeResponse {
  const { data } = useQuery(meQueryOptions);
  if (!data) throw new Error('useMe: no session in the cache; render under the /app layout');
  return data;
}

/** @rfc RFC-13 R3 */
export function hasPermission(me: Pick<MeResponse, 'permissions'>, key: PermissionKey): boolean {
  return me.permissions.includes(key);
}

/**
 * True only for the session-loss signal (`AUTH_UNAUTHENTICATED`, HTTP 401).
 * Other codes the API also answers with 401 — `AUTH_INVALID_CREDENTIALS`,
 * `AUTH_TOTP_INVALID`, `AUTH_MFA_EXPIRED` — are form errors for a mistyped
 * password or code, not a lost session, and must not sign the user out.
 * @rfc RFC-13 R4
 */
export function isSessionLoss(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === 'AUTH_UNAUTHENTICATED';
}

/**
 * Turns a 401 seen under `/app` into a return to `/`. The `me` query is
 * dropped only once navigation actually lands away from `/app` — a redirect
 * that lands back under `/app` (the API still considers the session valid)
 * leaves the query alone; dropping it first would make the observer refetch
 * and 401 again.
 * @rfc RFC-13 R4
 */
export function createSessionErrorHandler(deps: {
  queryClient: QueryClient;
  navigate: (to: '/') => Promise<void>;
  pathname: () => string;
}): (error: unknown) => void {
  let leaving = false;
  return (error) => {
    if (!isSessionLoss(error) || leaving || !deps.pathname().startsWith('/app')) return;
    leaving = true;
    void deps
      .navigate('/')
      .then(() => {
        if (!deps.pathname().startsWith('/app')) {
          deps.queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
        }
      })
      .finally(() => {
        leaving = false;
      });
  };
}
