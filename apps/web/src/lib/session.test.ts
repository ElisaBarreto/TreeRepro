import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { ADMIN_ME, ME } from '../test/fixtures.ts';
import {
  createSessionErrorHandler,
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

  it('under /app, a 401 navigates to / and then drops the me query; elsewhere it does nothing', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, ME);
    const navigate = vi.fn<(to: '/') => Promise<void>>().mockResolvedValue(undefined);
    let pathname = '/app/settings';
    const handle = createSessionErrorHandler({ queryClient, navigate, pathname: () => pathname });
    handle(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    expect(navigate).not.toHaveBeenCalled();
    handle(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    expect(navigate).toHaveBeenCalledWith('/');
    await vi.waitFor(() => expect(queryClient.getQueryData(ME_QUERY_KEY)).toBeUndefined());
    pathname = '/';
    navigate.mockClear();
    handle(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x'));
    expect(navigate).not.toHaveBeenCalled();
  });
});
