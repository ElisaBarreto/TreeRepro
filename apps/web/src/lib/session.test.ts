import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { ADMIN_ME, ME } from '../test/fixtures.ts';
import {
  createSessionErrorHandler,
  forgetSession,
  hasPermission,
  isSessionLoss,
  ME_QUERY_KEY,
} from './session.ts';

describe('RFC-13 R3 hasPermission', () => {
  it('answers from me.permissions', () => {
    expect(hasPermission(ME, 'admin.access')).toBe(false);
    expect(hasPermission(ADMIN_ME, 'admin.access')).toBe(true);
    expect(hasPermission({ permissions: ['users.read'] }, 'users.read')).toBe(true);
  });
});

describe('RFC-13 R4 session loss', () => {
  it('recognises an AUTH_UNAUTHENTICATED 401 only', () => {
    expect(isSessionLoss(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'))).toBe(true);
    expect(isSessionLoss(new ApiError(403, 'PERMISSION_DENIED', 'x'))).toBe(false);
    expect(isSessionLoss(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'))).toBe(false);
    expect(isSessionLoss(new Error('x'))).toBe(false);
  });

  it('forgets every query and every mutation, not only me', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, ME);
    queryClient.setQueryData(['me', 'sessions'], []);
    const mutation = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: async () => 'JBSWY3DPEHPK3PXP' });
    await mutation.execute(undefined);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    forgetSession(queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('under /app, a 401 navigates to / and then drops every query; elsewhere it does nothing', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, ME);
    queryClient.setQueryData(['me', 'sessions'], []);
    let pathname = '/app/settings';
    // The navigation actually lands on / — flip pathname the way the router would.
    const navigate = vi.fn<(to: '/') => Promise<void>>().mockImplementation(async () => {
      pathname = '/';
    });
    const handle = createSessionErrorHandler({ queryClient, navigate, pathname: () => pathname });
    handle(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    expect(navigate).not.toHaveBeenCalled();
    handle(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    expect(navigate).toHaveBeenCalledWith('/');
    await vi.waitFor(() => expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined());
    expect(queryClient.getQueryData(['me', 'sessions'])).toBeUndefined();
    navigate.mockClear();
    handle(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves the me query alone when the redirect lands back under /app', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, ME);
    // The navigation resolves, but a beforeLoad redirect sent us right back to /app.
    const navigate = vi.fn<(to: '/') => Promise<void>>().mockResolvedValue(undefined);
    const handle = createSessionErrorHandler({
      queryClient,
      navigate,
      pathname: () => '/app/settings',
    });
    handle(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    expect(navigate).toHaveBeenCalledWith('/');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toEqual(ME);
  });

  it('coalesces concurrent 401s into one navigation and re-arms afterwards', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, ME);
    let pathname = '/app';
    let resolve!: () => void;
    const navigate = vi.fn<(to: '/') => Promise<void>>(
      () =>
        new Promise<void>((r) => {
          // The navigation actually lands on / — flip pathname the way the router would.
          resolve = () => {
            pathname = '/';
            r();
          };
        }),
    );
    const handle = createSessionErrorHandler({ queryClient, navigate, pathname: () => pathname });

    handle(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    handle(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    expect(navigate).toHaveBeenCalledTimes(1);

    resolve();
    await vi.waitFor(() => expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined());

    // Back under /app for a fresh session — a later 401 should navigate again.
    pathname = '/app';
    handle(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
