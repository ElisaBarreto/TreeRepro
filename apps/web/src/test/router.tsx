import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { createAppQueryClient, createSessionErrorHandler } from '../lib/session.ts';
import { routeTree } from '../routeTree.gen.ts';

/**
 * Mounts the real route tree at `path` with an in-memory history, wired the
 * way `main.tsx` wires production (`createAppQueryClient`, router context,
 * 401 handler) — only retries are off, so tests fail fast.
 * @rfc RFC-01 R2
 */
export function renderAt(path: string) {
  const { queryClient, setSessionErrorHandler } = createAppQueryClient({ retry: false });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  setSessionErrorHandler(
    createSessionErrorHandler({
      queryClient,
      navigate: (to) => router.navigate({ to }),
      pathname: () => router.state.location.pathname,
    }),
  );
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
