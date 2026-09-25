import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { INVITED_USER, ROLE_ADMIN, ROLE_MANAGER, ROLE_READERS } from '../../test/admin-fixtures.ts';
import { ADMIN_ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { InviteUserDialog } from './InviteUserDialog.tsx';

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
  admin.inviteUser.mockReset();
  admin.listRoles.mockReset().mockResolvedValue([ROLE_ADMIN, ROLE_MANAGER, ROLE_READERS]);
});

function mount(me: MeResponse = ADMIN_ME) {
  const onClose = vi.fn();
  const onInvited = vi.fn();
  renderWithProviders(<InviteUserDialog onClose={onClose} onInvited={onInvited} />, { me });
  return { onClose, onInvited };
}

async function fillAndSubmit(email: string, name: string, role: string | null = 'Readers') {
  const dialog = screen.getByRole('dialog', { name: 'Invite user' });
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Name'), name);
  if (role) {
    await screen.findByRole('option', { name: role });
    await userEvent.selectOptions(screen.getByLabelText('Role'), role);
  }
  await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  return dialog;
}

const optionNames = async () => {
  await screen.findByRole('option', { name: 'Readers' });
  return screen
    .getAllByRole('option')
    .map((o) => o.textContent)
    .filter((n) => n !== 'Choose a role');
};

describe('RFC-50 R3 InviteUserDialog', () => {
  it('invites and reports the created user', async () => {
    admin.inviteUser.mockResolvedValue(INVITED_USER);
    const { onInvited } = mount();
    await fillAndSubmit('bea@example.org', 'Bea');
    await waitFor(() =>
      expect(admin.inviteUser).toHaveBeenCalledWith({
        email: 'bea@example.org',
        name: 'Bea',
        roles: [ROLE_READERS.id],
      }),
    );
    expect(onInvited).toHaveBeenCalledWith(INVITED_USER, false);
  });

  it('reports MAIL_SEND_FAILED with a null user and mailFailed true', async () => {
    admin.inviteUser.mockRejectedValue(new ApiError(502, 'MAIL_SEND_FAILED', 'x'));
    const { onInvited } = mount();
    await fillAndSubmit('bea@example.org', 'Bea');
    await waitFor(() => expect(onInvited).toHaveBeenCalledWith(null, true));
  });

  it('shows a VALIDATION_FAILED detail under its named field', async () => {
    admin.inviteUser.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'x', [{ path: 'name', message: 'Too long' }]),
    );
    mount();
    await fillAndSubmit('bea@example.org', 'Bea');
    expect(await screen.findByText('Too long')).toBeInTheDocument();
  });

  it('requires a role: no request without one', async () => {
    mount();
    await screen.findByRole('option', { name: 'Readers' });
    await fillAndSubmit('bea@example.org', 'Bea', null);
    expect(await screen.findByText('Choose a role.')).toBeInTheDocument();
    expect(admin.inviteUser).not.toHaveBeenCalled();
  });
});

describe('RFC-31 R14 InviteUserDialog offers only the roles within the ceiling', () => {
  it('offers every role to an admin', async () => {
    mount();
    expect(await optionNames()).toEqual(['admin', 'manager', 'Readers']);
  });

  it('offers a non-admin neither admin nor a role above their permissions', async () => {
    mount({ ...ADMIN_ME, permissions: ['users.invite', 'users.read', 'roles.read'] });
    expect(await optionNames()).toEqual(['Readers']);
  });
});
