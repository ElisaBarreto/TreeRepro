import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppQueryClient, createSessionErrorHandler } from './lib/session.ts';
import { routeTree } from './routeTree.gen.ts';
import './styles.css';

// The handler needs the router and the router needs the client: the client
// comes first, the handler is bound once the router exists.
const { queryClient, setSessionErrorHandler } = createAppQueryClient();
const router = createRouter({ routeTree, context: { queryClient } });
setSessionErrorHandler(
  createSessionErrorHandler({
    queryClient,
    navigate: (to) => router.navigate({ to }),
    pathname: () => router.state.location.pathname,
  }),
);

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
