import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  PERMISSION_ENTRIES,
  ROLE_ADMIN,
  ROLE_MANAGER,
  ROLE_READERS,
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

const VIEWER: MeResponse = { ...ME, permissions: ['admin.access', 'roles.read'] };

beforeEach(() => {
  auth.fetchMe.mockReset();
  admin.listRoles.mockReset();
  admin.createRole.mockReset();
  admin.updateRole.mockReset();
  admin.deleteRole.mockReset();
  admin.listPermissions.mockReset();
  admin.listRoles.mockResolvedValue([ROLE_ADMIN, ROLE_READERS]);
  admin.listPermissions.mockResolvedValue(PERMISSION_ENTRIES);
});

async function openPage() {
  const utils = renderAt('/app/admin/roles');
  expect(await screen.findByRole('heading', { name: 'Roles' })).toBeInTheDocument();
  return utils;
}

describe('RFC-13 R2, RFC-50 R10 RolesPage', () => {
  it('lists roles with the system badge and the permission count; a viewer sees no actions', async () => {
    auth.fetchMe.mockResolvedValue(VIEWER);
    await openPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Name', 'Description', 'Permissions', 'Actions']);
    const adminCells = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(adminCells[0]).toHaveTextContent('admin');
    expect(within(adminCells[0] as HTMLElement).getByText('system')).toBeInTheDocument();
    expect(adminCells[2]).toHaveTextContent('all');
    expect(within(rows[2] as HTMLElement).getAllByRole('cell')[2]).toHaveTextContent('1');
    // Scoped to the page content: the AppShell chrome always renders its own
    // "Sign out" button, unrelated to this page's actions.
    expect(within(screen.getByRole('main')).queryByRole('button')).not.toBeInTheDocument();
    expect(admin.listPermissions).not.toHaveBeenCalled();
  });

  it('RFC-31 R11 a manager system role shows the system badge, its permission count, and no Edit / Delete buttons', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.listRoles.mockResolvedValue([ROLE_ADMIN, ROLE_MANAGER, ROLE_READERS]);
    await openPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4);
    const managerCells = within(rows[2] as HTMLElement).getAllByRole('cell');
    expect(managerCells[0]).toHaveTextContent('manager');
    expect(within(managerCells[0] as HTMLElement).getByText('system')).toBeInTheDocument();
    expect(managerCells[2]).toHaveTextContent(String(ROLE_MANAGER.permissions.length));
    expect(within(rows[2] as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    // The admin row still reads "all", not a raw (empty) count.
    expect(within(rows[1] as HTMLElement).getAllByRole('cell')[2]).toHaveTextContent('all');
  });

  it('RFC-31 R3 creates a role from the grouped catalog, hiding retired keys', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.createRole.mockResolvedValue({
      ...ROLE_READERS,
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8a03',
      name: 'Curators',
      permissions: ['dataset.read', 'records.annotate'],
    });
    await openPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'New role' }));
    const dialog = screen.getByRole('dialog', { name: 'New role' });
    expect(await within(dialog).findByRole('group', { name: 'users' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: /Erase users/ })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Curators');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Annotate records');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Browse species/ }));
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /Validate and contest records/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));
    await waitFor(() =>
      expect(admin.createRole).toHaveBeenCalledWith({
        name: 'Curators',
        description: 'Annotate records',
        permissions: ['dataset.read', 'records.annotate'],
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(admin.listRoles).toHaveBeenCalledTimes(2));
  });

  it('RFC-31 R3 ROLE_NAME_TAKEN is a field error; PERMISSION_UNKNOWN a form error', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.createRole
      .mockRejectedValueOnce(new ApiError(409, 'ROLE_NAME_TAKEN', 'x'))
      .mockRejectedValueOnce(
        new ApiError(400, 'PERMISSION_UNKNOWN', 'x', [{ path: 'permissions', message: 'x' }]),
      );
    await openPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'New role' }));
    const dialog = screen.getByRole('dialog', { name: 'New role' });
    await within(dialog).findByRole('group', { name: 'users' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Readers');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));
    expect(
      await within(dialog).findByText('Another role already has this name.'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'One of the permissions is unknown. Reload the page.',
    );
  });

  it('RFC-31 R4 edits a role with its current permissions checked', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.updateRole.mockResolvedValue({
      ...ROLE_READERS,
      permissions: ['users.read', 'audit.read'],
    });
    await openPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    await userEvent.click(
      within(rows[2] as HTMLElement).getByRole('button', { name: 'Edit Readers' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit role' });
    expect(
      await within(dialog).findByRole('checkbox', { name: /List and view users/ }),
    ).toBeChecked();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Read the audit log/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      expect(admin.updateRole).toHaveBeenCalledWith(ROLE_READERS.id, {
        name: 'Readers',
        description: 'May list users',
        permissions: ['users.read', 'audit.read'],
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('RFC-31 R5 deletes after confirming; ROLE_IS_SYSTEM is mapped', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.deleteRole
      .mockRejectedValueOnce(new ApiError(409, 'ROLE_IS_SYSTEM', 'x'))
      .mockResolvedValueOnce(undefined);
    await openPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    await userEvent.click(
      within(rows[2] as HTMLElement).getByRole('button', { name: 'Delete Readers' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete Readers?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'System roles cannot be changed.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(admin.deleteRole).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(admin.listRoles).toHaveBeenCalledTimes(2));
  });

  it('RFC-13 R4 a 403 shows the permission sentence; an empty list says so', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.listRoles.mockRejectedValueOnce(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    first.unmount();
    admin.listRoles.mockResolvedValue([]);
    await openPage();
    expect(await screen.findByText('No roles yet.')).toBeInTheDocument();
  });
});
