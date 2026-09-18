import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse, User } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  ADMIN_SESSION,
  ADMIN_USER,
  INVITED_USER,
  ROLE_ADMIN,
  ROLE_READERS,
  SUSPENDED_USER,
} from '../../test/admin-fixtures.ts';
import { ADMIN_ME, ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

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
vi.mock('../../api/auth.ts', () => auth);

const admin = vi.hoisted(() => ({
  listUsers: vi.fn(),
  fetchUser: vi.fn(),
  inviteUser: vi.fn(),
  updateUser: vi.fn(),
  setUserPlots: vi.fn(),
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

const plotsApi = vi.hoisted(() => ({
  listPlots: vi.fn(),
}));
vi.mock('../../api/plots.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/plots.ts')>()),
  ...plotsApi,
}));

const VIEWER: MeResponse = { ...ME, permissions: ['admin.access', 'users.read'] };

beforeEach(() => {
  for (const fn of Object.values(admin))
    if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
  auth.fetchMe.mockReset();
  plotsApi.listPlots.mockReset();
  plotsApi.listPlots.mockResolvedValue({ data: [], meta: { nextCursor: null, hasMore: false } });
  admin.listRoles.mockResolvedValue([ROLE_ADMIN, ROLE_READERS]);
  admin.listUserSessions.mockResolvedValue([ADMIN_SESSION]);
});

async function openUser(user: User) {
  admin.fetchUser.mockResolvedValue(user);
  const utils = renderAt(`/app/admin/users/${user.id}`);
  expect(await screen.findByRole('heading', { name: user.name })).toBeInTheDocument();
  return utils;
}

describe('RFC-13 R2, RFC-50 R4 UserPage', () => {
  it('shows the header facts and, for a viewer, no actions and read-only roles', async () => {
    auth.fetchMe.mockResolvedValue(VIEWER);
    await openUser(SUSPENDED_USER);
    expect(screen.getByText('cid@example.org')).toBeInTheDocument();
    expect(screen.getByText('suspended')).toBeInTheDocument();
    expect(screen.getByText('Two-factor on')).toBeInTheDocument();
    expect(screen.getByText('Created 2026-09-11')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Suspend|Reactivate|Resend invitation|Save/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Roles' })).getByText('Readers'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sessions' })).not.toBeInTheDocument();
    expect(admin.listUserSessions).not.toHaveBeenCalled();
  });

  it('RFC-71 R5 links to the contributions of this user with contributions.read', async () => {
    auth.fetchMe.mockResolvedValue(VIEWER);
    const { unmount } = await openUser(SUSPENDED_USER);
    expect(screen.queryByRole('link', { name: 'View contributions' })).not.toBeInTheDocument();
    unmount();

    auth.fetchMe.mockResolvedValue({
      ...VIEWER,
      permissions: [...VIEWER.permissions, 'contributions.read'],
    });
    await openUser(SUSPENDED_USER);
    expect(screen.getByRole('link', { name: 'View contributions' })).toHaveAttribute(
      'href',
      `/app/contributions?userId=${SUSPENDED_USER.id}`,
    );
  });

  it('RFC-13 R4 an unknown id reads as not found; a 403 as the permission sentence', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.fetchUser.mockRejectedValueOnce(new ApiError(404, 'USER_NOT_FOUND', 'x'));
    const first = renderAt(`/app/admin/users/${INVITED_USER.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('This user does not exist.');
    first.unmount();
    admin.fetchUser.mockRejectedValueOnce(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    renderAt(`/app/admin/users/${INVITED_USER.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
  });

  it('RFC-50 R5 saves the name and updates the header', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.updateUser.mockResolvedValue({ ...INVITED_USER, name: 'Beatriz' });
    await openUser(INVITED_USER);
    const region = screen.getByRole('region', { name: 'Name' });
    await userEvent.clear(within(region).getByLabelText('Name'));
    await userEvent.type(within(region).getByLabelText('Name'), 'Beatriz');
    // The write invalidates the detail query too, so it refetches: point the
    // mock at the same committed user before triggering that refetch.
    admin.fetchUser.mockResolvedValue({ ...INVITED_USER, name: 'Beatriz' });
    await userEvent.click(within(region).getByRole('button', { name: 'Save name' }));
    await waitFor(() =>
      expect(admin.updateUser).toHaveBeenCalledWith(INVITED_USER.id, { name: 'Beatriz' }),
    );
    expect(await screen.findByRole('heading', { name: 'Beatriz' })).toBeInTheDocument();
    expect(within(region).getByRole('status')).toHaveTextContent('Name saved.');
  });

  it('RFC-50 R5, RFC-31 R7 saves roles; ROLE_LAST_ADMIN is mapped', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    const BOTH_ROLES: User = {
      ...ADMIN_USER,
      roles: [
        { id: ROLE_ADMIN.id, name: 'admin' },
        { id: ROLE_READERS.id, name: 'Readers' },
      ],
    };
    admin.updateUser
      .mockRejectedValueOnce(new ApiError(409, 'ROLE_LAST_ADMIN', 'x'))
      .mockResolvedValueOnce(BOTH_ROLES);
    await openUser(ADMIN_USER);
    const region = screen.getByRole('region', { name: 'Roles' });
    // The accessible name is the whole label (name, badge, description): match its start.
    const adminBox = await within(region).findByRole('checkbox', { name: /^admin\b/ });
    expect(adminBox).toBeChecked();
    await userEvent.click(adminBox);
    await userEvent.click(within(region).getByRole('button', { name: 'Save roles' }));
    await waitFor(() =>
      expect(admin.updateUser).toHaveBeenCalledWith(ADMIN_USER.id, { roles: [] }),
    );
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'This is the last active administrator.',
    );
    await userEvent.click(adminBox);
    await userEvent.click(within(region).getByRole('checkbox', { name: /^Readers\b/ }));
    // The write invalidates the detail query too, so it refetches: point the
    // mock at the same committed user before triggering that refetch.
    admin.fetchUser.mockResolvedValue(BOTH_ROLES);
    await userEvent.click(within(region).getByRole('button', { name: 'Save roles' }));
    await waitFor(() =>
      expect(admin.updateUser).toHaveBeenLastCalledWith(ADMIN_USER.id, {
        roles: [ROLE_ADMIN.id, ROLE_READERS.id],
      }),
    );
    expect(await within(region).findByRole('status')).toHaveTextContent('Roles saved.');
  });

  it('RFC-50 R6-R7 suspends after confirming (refreshing sessions), then offers Reactivate; ROLE_LAST_ADMIN keeps the dialog open', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    const SUSPENDED: User = {
      ...ADMIN_USER,
      status: 'suspended',
      suspendedAt: '2026-09-13T09:00:00.000Z',
    };
    admin.suspendUser
      .mockRejectedValueOnce(new ApiError(409, 'ROLE_LAST_ADMIN', 'x'))
      .mockResolvedValueOnce(SUSPENDED);
    admin.reactivateUser.mockResolvedValue(ADMIN_USER);
    await openUser(ADMIN_USER);
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspend Ada?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This is the last active administrator.',
    );
    expect(screen.getByRole('dialog', { name: 'Suspend Ada?' })).toBeInTheDocument();
    // The write invalidates the detail (and sessions) query too, so both
    // refetch: point the mock at the same committed user before retrying.
    admin.fetchUser.mockResolvedValue(SUSPENDED);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(admin.suspendUser).toHaveBeenCalledTimes(2));
    expect(admin.suspendUser).toHaveBeenCalledWith(ADMIN_USER.id);
    expect(await screen.findByText('suspended')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // RFC-50 R6: suspending deletes every session server-side, so the
    // mounted sessions table must refetch, not just go stale.
    await waitFor(() => expect(admin.listUserSessions).toHaveBeenCalledTimes(2));
    admin.fetchUser.mockResolvedValue(ADMIN_USER);
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Reactivate Ada?' })).getByRole('button', {
        name: 'Reactivate',
      }),
    );
    await waitFor(() => expect(admin.reactivateUser).toHaveBeenCalledWith(ADMIN_USER.id));
    expect(await screen.findByText('active')).toBeInTheDocument();
  });

  it('RFC-50 R8 resends the invitation only for an invited user; USER_INVALID_STATUS and MAIL_SEND_FAILED are mapped', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.resendInvite
      .mockRejectedValueOnce(new ApiError(502, 'MAIL_SEND_FAILED', 'x'))
      .mockRejectedValueOnce(new ApiError(409, 'USER_INVALID_STATUS', 'x'))
      .mockResolvedValueOnce(INVITED_USER);
    await openUser(INVITED_USER);
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Resend invitation' });
    await userEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The invitation email could not be sent. Try again later.',
    );
    await userEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This action does not apply to the user's current status. Reload the page.",
    );
    await userEvent.click(button);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to bea@example.org.',
    );
  });

  it('RFC-50 R9 lists sessions with sessions.read and revokes with sessions.revoke', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.revokeUserSession.mockResolvedValue(undefined);
    admin.revokeAllUserSessions.mockResolvedValue(undefined);
    await openUser(ADMIN_USER);
    const region = screen.getByRole('region', { name: 'Sessions' });
    const row = (await within(region).findAllByRole('row'))[1] as HTMLElement;
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('203.0.113.7');
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('2026-09-13 09:30');
    await userEvent.click(within(row).getByRole('button', { name: /^Sign out/ }));
    await waitFor(() =>
      expect(admin.revokeUserSession).toHaveBeenCalledWith(ADMIN_USER.id, ADMIN_SESSION.id),
    );
    await userEvent.click(within(region).getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(admin.revokeAllUserSessions).toHaveBeenCalledWith(ADMIN_USER.id));
    await waitFor(() => expect(admin.listUserSessions).toHaveBeenCalledTimes(3));
  });

  it('RFC-13 R3 sessions.read without sessions.revoke shows the table without buttons', async () => {
    auth.fetchMe.mockResolvedValue({
      ...ME,
      permissions: ['admin.access', 'users.read', 'sessions.read'],
    });
    await openUser(ADMIN_USER);
    const region = screen.getByRole('region', { name: 'Sessions' });
    await within(region).findAllByRole('row');
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });
});
