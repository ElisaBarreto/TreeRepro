import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSION_ENTRIES, ROLE_READERS } from '../../test/admin-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { groupPermissions, RoleDialog } from './RoleDialog.tsx';

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
  admin.listPermissions.mockReset();
  admin.updateRole.mockReset();
  admin.listPermissions.mockResolvedValue(PERMISSION_ENTRIES);
});

describe('RFC-30 R1, R2 groupPermissions', () => {
  it('groups the catalog by resource prefix in catalog order, hiding retired keys', () => {
    const groups = groupPermissions(PERMISSION_ENTRIES);
    expect(groups.map((g) => g.resource)).toEqual([
      'users',
      'roles',
      'sessions',
      'audit',
      'admin',
      'dataset',
      'imports',
      'records',
      'taxa',
      'references',
      'traits',
      'plots',
      'contributions',
      'coverage',
      'health',
    ]);
    expect(groups.flatMap((g) => g.entries.map((e) => e.key))).not.toContain('users.delete');
    const distinctPrefixes = new Set(PERMISSION_ENTRIES.map((e) => e.key.split('.')[0]));
    expect(groups).toHaveLength(distinctPrefixes.size);
  });
});

describe('RFC-31 R4 RoleDialog', () => {
  it('keeps a hidden retired key the edited role already holds in the payload', async () => {
    admin.updateRole.mockResolvedValue(ROLE_READERS);
    const role = { ...ROLE_READERS, permissions: ['users.read', 'users.delete'] };
    renderWithProviders(<RoleDialog role={role} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Edit role' });
    await within(dialog).findByRole('group', { name: 'users' });
    expect(within(dialog).queryByRole('checkbox', { name: /Erase users/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      expect(admin.updateRole).toHaveBeenCalledWith(role.id, {
        name: 'Readers',
        description: 'May list users',
        permissions: ['users.read', 'users.delete'],
      }),
    );
  });
});
