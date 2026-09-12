import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createSessionErrorHandler } from './lib/session.ts';
import { routeTree } from './routeTree.gen.ts';
import './styles.css';

// The handler needs the router and the router needs the client: wire the
// client first with a late-bound handler.
let onSessionError: (error: unknown) => void = () => {};
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => onSessionError(error) }),
  mutationCache: new MutationCache({ onError: (error) => onSessionError(error) }),
});
const router = createRouter({ routeTree, context: { queryClient } });
onSessionError = createSessionErrorHandler({
  queryClient,
  navigate: (to) => router.navigate({ to }),
  pathname: () => router.state.location.pathname,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
