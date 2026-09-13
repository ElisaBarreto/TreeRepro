import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { ADMIN_USER, INVITED_USER, page, SUSPENDED_USER } from '../../test/admin-fixtures.ts';
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

const READ_ONLY: MeResponse = { ...ME, permissions: ['admin.access', 'users.read'] };

beforeEach(() => {
  auth.fetchMe.mockReset();
  admin.listUsers.mockReset();
  admin.inviteUser.mockReset();
});

async function openPage() {
  const utils = renderAt('/app/admin/users');
  expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
  return utils;
}

describe('RFC-13 R2, RFC-50 R2 UsersPage', () => {
  it('lists users with status, roles and created date, links to the detail page', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.listUsers.mockResolvedValue(page([INVITED_USER, ADMIN_USER, SUSPENDED_USER]));
    await openPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Name', 'Email', 'Status', 'Roles', 'Created']);
    expect(admin.listUsers).toHaveBeenCalledWith({
      status: undefined,
      cursor: undefined,
      limit: 50,
    });
    const bea = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(within(bea[0] as HTMLElement).getByRole('link', { name: 'Bea' })).toHaveAttribute(
      'href',
      `/app/admin/users/${INVITED_USER.id}`,
    );
    expect(bea[1]).toHaveTextContent('bea@example.org');
    expect(bea[2]).toHaveTextContent('invited');
    expect(bea[3]).toHaveTextContent('—');
    expect(bea[4]).toHaveTextContent('2026-09-13');
    const cid = within(rows[3] as HTMLElement).getAllByRole('cell');
    expect(cid[2]).toHaveTextContent('suspended');
    expect(cid[3]).toHaveTextContent('Readers');
    expect(within(rows[2] as HTMLElement).getAllByRole('cell')[3]).toHaveTextContent('admin');
  });

  it('filters by status and starts over at page 1', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.listUsers.mockResolvedValue(page([ADMIN_USER]));
    await openPage();
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'suspended');
    await waitFor(() =>
      expect(admin.listUsers).toHaveBeenLastCalledWith({
        status: 'suspended',
        cursor: undefined,
        limit: 50,
      }),
    );
  });

  it('says so when the list is empty; shows the 403 sentence on a permission failure', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.listUsers.mockResolvedValue(page([]));
    const first = await openPage();
    expect(await screen.findByText('No users match.')).toBeInTheDocument();
    first.unmount();
    admin.listUsers.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
  });

  it('RFC-13 R3 hides Invite user without users.invite', async () => {
    auth.fetchMe.mockResolvedValue(READ_ONLY);
    admin.listUsers.mockResolvedValue(page([ADMIN_USER]));
    await openPage();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Invite user' })).not.toBeInTheDocument();
  });

  it('RFC-50 R3 invites a user and refreshes the list', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.listUsers
      .mockResolvedValueOnce(page([ADMIN_USER]))
      .mockResolvedValue(page([INVITED_USER, ADMIN_USER]));
    admin.inviteUser.mockResolvedValue(INVITED_USER);
    await openPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = screen.getByRole('dialog', { name: 'Invite user' });
    await userEvent.type(within(dialog).getByLabelText('Email'), 'bea@example.org');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Bea');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() =>
      expect(admin.inviteUser).toHaveBeenCalledWith({ email: 'bea@example.org', name: 'Bea' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to bea@example.org.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(admin.listUsers).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('link', { name: 'Bea' })).toBeInTheDocument();
  });

  it('RFC-50 R3 MAIL_SEND_FAILED closes the dialog with the resend hint; USER_EMAIL_TAKEN is a field error', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.listUsers.mockResolvedValue(page([ADMIN_USER]));
    admin.inviteUser
      .mockRejectedValueOnce(new ApiError(409, 'USER_EMAIL_TAKEN', 'x'))
      .mockRejectedValueOnce(new ApiError(502, 'MAIL_SEND_FAILED', 'x'));
    await openPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = screen.getByRole('dialog', { name: 'Invite user' });
    await userEvent.type(within(dialog).getByLabelText('Email'), 'ada@example.org');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Ada');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(
      await within(dialog).findByText('Another account already uses this email.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The user was created but the invitation email failed. Open the user and use Resend invitation.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(admin.listUsers).toHaveBeenCalledTimes(2));
  });

  it('validates locally before calling the API', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.listUsers.mockResolvedValue(page([ADMIN_USER]));
    await openPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = screen.getByRole('dialog', { name: 'Invite user' });
    await userEvent.type(within(dialog).getByLabelText('Email'), 'not-an-email');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a name (up to 120 characters).')).toBeInTheDocument();
    expect(admin.inviteUser).not.toHaveBeenCalled();
  });
});
