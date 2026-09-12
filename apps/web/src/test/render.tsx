import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderOptions, render } from '@testing-library/react';
import type { MeResponse } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { ME_QUERY_KEY } from '../lib/session.ts';

/**
 * Renders under a fresh QueryClient with retries off, so tests fail fast;
 * `me` seeds the session the `/app` layout would have resolved.
 * @rfc RFC-01 R2
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions & { me?: MeResponse } = {},
) {
  const { me, ...rest } = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (me) queryClient.setQueryData(ME_QUERY_KEY, me);
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, rest),
  };
}
