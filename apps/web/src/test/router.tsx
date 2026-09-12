import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { createSessionErrorHandler } from '../lib/session.ts';
import { routeTree } from '../routeTree.gen.ts';

/**
 * Mounts the real route tree at `path` with an in-memory history, wired the
 * way `main.tsx` wires production (router context, 401 handler).
 * @rfc RFC-01 R2
 */
export function renderAt(path: string) {
  let onSessionError: (error: unknown) => void = () => {};
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    queryCache: new QueryCache({ onError: (error) => onSessionError(error) }),
    mutationCache: new MutationCache({ onError: (error) => onSessionError(error) }),
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  onSessionError = createSessionErrorHandler({
    queryClient,
    navigate: (to) => router.navigate({ to }),
    pathname: () => router.state.location.pathname,
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
