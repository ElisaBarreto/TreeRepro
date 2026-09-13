import { screen } from '@testing-library/react';
import type { MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from '../../test/admin-fixtures.ts';
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

const NO_ADMIN_ACCESS: MeResponse = { ...ME, permissions: ['users.read'] };

beforeEach(() => {
  auth.fetchMe.mockReset();
  admin.listUsers.mockReset();
  admin.listUsers.mockResolvedValue(page([]));
});

describe('RFC-13 R3 /app/admin layout', () => {
  it('renders the no-permission sentence without admin.access and never calls the API', async () => {
    auth.fetchMe.mockResolvedValue(NO_ADMIN_ACCESS);
    renderAt('/app/admin/users');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this area.',
    );
    expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument();
    expect(admin.listUsers).not.toHaveBeenCalled();
  });

  it('renders the page with admin.access', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    renderAt('/app/admin/users');
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
  });
});
