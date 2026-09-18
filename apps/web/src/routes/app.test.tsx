import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { DASHBOARD } from '../test/dataset-fixtures.ts';
import { ME } from '../test/fixtures.ts';
import { renderAt } from '../test/router.tsx';

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
}));
const me = vi.hoisted(() => ({
  updateName: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
}));
// The `/app` index route renders WorkspacePage (RFC-72), which reads the
// dashboard query; mocked here purely so it resolves quietly and never
// contributes a stray error alert to these session-guard assertions.
const dashboard = vi.hoisted(() => ({ fetchDashboard: vi.fn() }));
vi.mock('../api/auth.ts', () => auth);
vi.mock('../api/me.ts', () => me);
vi.mock('../api/dashboard.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/dashboard.ts')>()),
  ...dashboard,
}));
vi.mock('qrcode', () => ({ toCanvas: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  auth.fetchMe.mockReset();
  auth.logout.mockReset();
  me.listSessions.mockReset();
  dashboard.fetchDashboard.mockReset().mockResolvedValue(DASHBOARD);
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
    queryClient.setQueryData(['me', 'sessions'], []);
    auth.fetchMe.mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    await userEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(queryClient.getQueryData(['auth', 'me'])).toBeUndefined());
    expect(queryClient.getQueryData(['me', 'sessions'])).toBeUndefined();
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it('RFC-13 R4, R8 a 401 from a call made on /app/settings returns to / and forgets the session', async () => {
    auth.fetchMe
      .mockResolvedValueOnce(ME)
      .mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    me.listSessions.mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    const { router, queryClient } = renderAt('/app/settings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(queryClient.getQueryData(['auth', 'me'])).toBeUndefined());
    expect(queryClient.getQueryData(['me', 'sessions'])).toBeUndefined();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(me.listSessions).toHaveBeenCalledTimes(1);
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
