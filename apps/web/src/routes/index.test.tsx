import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { PROJECT_HEADLINE } from '../content/project.ts';
import { DASHBOARD } from '../test/dataset-fixtures.ts';
import { ME, USER } from '../test/fixtures.ts';
import { renderAt } from '../test/router.tsx';

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));
const dashboard = vi.hoisted(() => ({ fetchDashboard: vi.fn() }));
vi.mock('../api/auth.ts', () => auth);
vi.mock('../api/dashboard.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/dashboard.ts')>()),
  ...dashboard,
}));

// jsdom has no view transitions; a stub that runs the DOM update at once
// stands in for the browser's, so the test sees whether the route asked for one.
const startViewTransition = vi.fn((update: () => void) => {
  update();
  return {
    finished: Promise.resolve(),
    ready: Promise.resolve(),
    updateCallbackDone: Promise.resolve(),
    skipTransition() {},
  };
});

beforeEach(() => {
  // no session on the landing page, then a live one once the workspace loads
  auth.fetchMe
    .mockReset()
    .mockRejectedValueOnce(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'))
    .mockResolvedValue(ME);
  auth.login.mockReset().mockResolvedValue({ status: 'ok', user: USER });
  dashboard.fetchDashboard.mockReset().mockResolvedValue(DASHBOARD);
  startViewTransition.mockClear();
  Object.defineProperty(document, 'startViewTransition', {
    value: startViewTransition,
    configurable: true,
    writable: true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function signIn() {
  const typing = userEvent.setup();
  await typing.type(await screen.findByLabelText('Email'), 'ada@example.org');
  await typing.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await typing.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('RFC-13 R7 the / route after sign-in', () => {
  it('reaches /app through a view transition once the landing beats are over', async () => {
    const { router } = renderAt('/');
    await signIn();
    expect(router.state.location.pathname).toBe('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'), { timeout: 4000 });
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole('heading', { level: 1, name: PROJECT_HEADLINE }),
    ).toBeInTheDocument();
  });

  it('starts the page afresh when /app bounces the visitor back to /', async () => {
    // the session never resolves: /app's guard redirects to / every time
    auth.fetchMe.mockReset().mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    const { router } = renderAt('/');
    await signIn();
    // /'s guard, /app's guard, then /'s guard again on the way back
    await waitFor(() => expect(auth.fetchMe).toHaveBeenCalledTimes(3), { timeout: 4000 });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const card = await screen.findByRole('region', { name: 'Sign in to TreeRepro' });
    await waitFor(() => expect(card).not.toHaveClass('tr-recede'));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('reaches /app at once and plainly under prefers-reduced-motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const { router } = renderAt('/');
    await signIn();
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'), { timeout: 500 });
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});
