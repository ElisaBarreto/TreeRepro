import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { INVITED_USER } from '../../test/admin-fixtures.ts';
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
});

function mount() {
  const onClose = vi.fn();
  const onInvited = vi.fn();
  renderWithProviders(<InviteUserDialog onClose={onClose} onInvited={onInvited} />, {
    me: ADMIN_ME,
  });
  return { onClose, onInvited };
}

async function fillAndSubmit(email: string, name: string) {
  const dialog = screen.getByRole('dialog', { name: 'Invite user' });
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Name'), name);
  await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  return dialog;
}

describe('RFC-50 R3 InviteUserDialog', () => {
  it('invites and reports the created user', async () => {
    admin.inviteUser.mockResolvedValue(INVITED_USER);
    const { onInvited } = mount();
    await fillAndSubmit('bea@example.org', 'Bea');
    await waitFor(() =>
      expect(admin.inviteUser).toHaveBeenCalledWith({ email: 'bea@example.org', name: 'Bea' }),
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
});
