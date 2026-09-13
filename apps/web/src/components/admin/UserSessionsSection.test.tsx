import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SESSION, ADMIN_USER } from '../../test/admin-fixtures.ts';
import { ADMIN_ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { UserSessionsSection } from './UserSessionsSection.tsx';

const admin = vi.hoisted(() => ({
  listUsers: vi.fn(),
  fetchUser: vi.fn(),
  inviteUser: vi.fn(),
  updateUser: vi.fn(),
  suspendUser: vi.fn(),
  reactivateUser: vi.fn(),
  resendInvite: vi.fn(),
  listUserSessions: vi.fn(),
  revokeUserSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  listRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  listPermissions: vi.fn(),
  queryAudit: vi.fn(),
}));
vi.mock('../../api/admin.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/admin.ts')>()),
  ...admin,
}));

beforeEach(() => {
  admin.listUserSessions.mockReset();
  admin.revokeUserSession.mockReset();
});

describe('RFC-50 R9 UserSessionsSection', () => {
  it('shows an empty state when the list is empty', async () => {
    admin.listUserSessions.mockResolvedValue([]);
    renderWithProviders(<UserSessionsSection userId={ADMIN_USER.id} canRevoke />, { me: ADMIN_ME });
    expect(await screen.findByText('No active sessions.')).toBeInTheDocument();
  });

  it('a failed revoke still refetches the list (onSettled)', async () => {
    admin.listUserSessions.mockResolvedValue([ADMIN_SESSION]);
    admin.revokeUserSession.mockRejectedValue(new Error('boom'));
    renderWithProviders(<UserSessionsSection userId={ADMIN_USER.id} canRevoke />, { me: ADMIN_ME });
    await screen.findAllByRole('row');
    await userEvent.click(screen.getAllByRole('button', { name: /^Sign out/ })[0] as HTMLElement);
    await waitFor(() =>
      expect(admin.revokeUserSession).toHaveBeenCalledWith(ADMIN_USER.id, ADMIN_SESSION.id),
    );
    // The revoke rejected, yet the list still resyncs against the server
    // instead of trusting the failed request never happened.
    await waitFor(() => expect(admin.listUserSessions).toHaveBeenCalledTimes(2));
  });
});
