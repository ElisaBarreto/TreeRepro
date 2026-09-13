import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { ME } from '../test/fixtures.ts';
import { renderAt } from '../test/router.tsx';

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../api/auth.ts', () => auth);

beforeEach(() => {
  auth.fetchMe.mockReset();
  auth.logout.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('RFC-13 R2 session guard', () => {
  it('/app without a session goes to /', async () => {
    auth.fetchMe.mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    const { router } = renderAt('/app');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('/ with a session goes to /app and renders the shell', async () => {
    auth.fetchMe.mockResolvedValue(ME);
    const { router } = renderAt('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'));
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('RFC-13 R4 sign out returns to / and forgets the session', async () => {
    auth.fetchMe.mockResolvedValueOnce(ME);
    auth.logout.mockResolvedValue(undefined);
    const { router, queryClient } = renderAt('/app');
    const button = await screen.findByRole('button', { name: 'Sign out' });
    auth.fetchMe.mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    await userEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(queryClient.getQueryData(['auth', 'me'])).toBeUndefined());
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it('RFC-13 R4 a failed sign out keeps the session and shows an alert', async () => {
    auth.fetchMe.mockResolvedValue(ME);
    auth.logout.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    const { router, queryClient } = renderAt('/app');
    const button = await screen.findByRole('button', { name: 'Sign out' });
    await userEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out. Try again.');
    expect(router.state.location.pathname).toBe('/app');
    expect(queryClient.getQueryData(['auth', 'me'])).toBeDefined();
  });
});
