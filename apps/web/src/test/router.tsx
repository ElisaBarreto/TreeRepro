import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createAppQueryClient, createSessionErrorHandler } from '../lib/session.ts';
import { routeTree } from '../routeTree.gen.ts';

/**
 * `ui` under a minimal one-route memory router, for a component that renders
 * a router `Link` — a `HelpTip` with a "Learn more" target (RFC-73 R4), say —
 * without otherwise caring where it goes. It is an element, not a render, so
 * it composes with `renderWithProviders` where a QueryClient is needed too.
 * The router mounts on its own tick, so the first query after it must be an
 * awaited `findBy…`.
 * @rfc RFC-01 R2
 */
export function withRouter(ui: ReactElement): ReactElement {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
}

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
