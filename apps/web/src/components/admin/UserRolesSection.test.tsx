import { QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_USER, ROLE_ADMIN, ROLE_READERS, SUSPENDED_USER } from '../../test/admin-fixtures.ts';
import { ADMIN_ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { UserRolesSection } from './UserRolesSection.tsx';

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
  admin.listRoles.mockReset();
});

describe('RFC-50 R5 UserRolesSection', () => {
  it('re-seeds the checked set when a new user prop arrives with different roles', async () => {
    admin.listRoles.mockResolvedValue([ROLE_ADMIN, ROLE_READERS]);
    const utils = renderWithProviders(<UserRolesSection user={ADMIN_USER} canEdit />, {
      me: ADMIN_ME,
    });
    expect(await screen.findByRole('checkbox', { name: /^admin\b/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Readers\b/ })).not.toBeChecked();

    // A sibling section's write (or this section's own save) refreshes `user`
    // with a different set of roles: the checked set must follow it.
    utils.rerender(
      <QueryClientProvider client={utils.queryClient}>
        <UserRolesSection user={SUSPENDED_USER} canEdit />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('checkbox', { name: /^Readers\b/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^admin\b/ })).not.toBeChecked();
  });
});
