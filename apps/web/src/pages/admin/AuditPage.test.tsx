import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditLogEntry, MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { ADMIN_USER, AUDIT_ENTRY, INVITED_USER, page } from '../../test/admin-fixtures.ts';
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
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/admin.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/admin.ts')>()),
  ...admin,
}));

const AUDITOR: MeResponse = { ...ME, permissions: ['admin.access', 'audit.read'] };
const ANONYMOUS: AuditLogEntry = {
  ...AUDIT_ENTRY,
  id: '019a0000-0000-7000-8000-000000000002',
  at: '2026-09-13T10:25:00.000Z',
  actorUserId: null,
  action: 'auth.login.failure',
  targetType: null,
  targetId: null,
  userAgent: null,
  metadata: {},
};

beforeEach(() => {
  auth.fetchMe.mockReset();
  for (const fn of Object.values(admin)) fn.mockReset();
  admin.queryAudit.mockResolvedValue(page([AUDIT_ENTRY, ANONYMOUS]));
  admin.listUsers.mockResolvedValue(page([ADMIN_USER, INVITED_USER]));
});

async function openPage() {
  const utils = renderAt('/app/admin/audit');
  expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
  return utils;
}

describe('RFC-13 R2, RFC-51 R1 AuditPage', () => {
  it('lists entries newest first with actor names, targets, agents and metadata', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    await openPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['At', 'Actor', 'Action', 'Target', 'IP', 'User agent', 'Details']);
    expect(admin.queryAudit).toHaveBeenCalledWith({
      actor: undefined,
      action: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
      limit: 50,
    });
    const first = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(first[0]).toHaveTextContent('2026-09-13 10:20');
    expect(first[1]).toHaveTextContent('Ada');
    expect(first[2]).toHaveTextContent('users.created');
    expect(first[3]).toHaveTextContent(`user ${INVITED_USER.id.slice(0, 8)}`);
    expect(first[4]).toHaveTextContent('203.0.113.1');
    const agent = within(first[5] as HTMLElement).getByTitle(AUDIT_ENTRY.userAgent as string);
    expect(agent).toHaveTextContent(`${(AUDIT_ENTRY.userAgent as string).slice(0, 39)}…`);
    await userEvent.click(within(first[6] as HTMLElement).getByText('Metadata'));
    expect(within(first[6] as HTMLElement).getByText(/"fields"/)).toBeInTheDocument();
    const second = within(rows[2] as HTMLElement).getAllByRole('cell');
    expect(second[1]).toHaveTextContent('—');
    expect(second[3]).toHaveTextContent('—');
    expect(second[5]).toHaveTextContent('—');
    expect(second[6]).toHaveTextContent('—');
  });

  it('applies the filters as ISO instants and offers the users as a datalist', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    await openPage();
    await screen.findByRole('table');
    // jsdom does not expose a datalist `<option>` via role="option" (fallback per task-6 brief).
    expect(screen.getByText('Ada', { selector: 'option' })).toHaveValue(ADMIN_USER.id);
    await userEvent.type(screen.getByLabelText('Actor'), ADMIN_USER.id);
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'users.created');
    await userEvent.type(screen.getByLabelText('From'), '2026-09-01T00:00');
    await userEvent.type(screen.getByLabelText('To'), '2026-09-30T23:59');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(admin.queryAudit).toHaveBeenLastCalledWith({
        actor: ADMIN_USER.id,
        action: 'users.created',
        from: new Date('2026-09-01T00:00').toISOString(),
        to: new Date('2026-09-30T23:59').toISOString(),
        cursor: undefined,
        limit: 50,
      }),
    );
  });

  it('rejects a malformed actor id and from after to before asking the API', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    await openPage();
    await screen.findByRole('table');
    await userEvent.type(screen.getByLabelText('Actor'), 'ada');
    await userEvent.type(screen.getByLabelText('From'), '2026-09-30T00:00');
    await userEvent.type(screen.getByLabelText('To'), '2026-09-01T00:00');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Enter a user id.')).toBeInTheDocument();
    expect(screen.getByText('From must not be later than To.')).toBeInTheDocument();
    expect(admin.queryAudit).toHaveBeenCalledTimes(1);
  });

  it('RFC-13 R3 without users.read the actor column shows short ids and no datalist is requested', async () => {
    auth.fetchMe.mockResolvedValue(AUDITOR);
    await openPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getAllByRole('cell')[1]).toHaveTextContent(
      ADMIN_USER.id.slice(0, 8),
    );
    expect(admin.listUsers).not.toHaveBeenCalled();
    expect(screen.queryByRole('option', { name: 'Ada' })).not.toBeInTheDocument();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; an empty log says so', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    admin.queryAudit.mockRejectedValueOnce(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    first.unmount();
    admin.queryAudit.mockResolvedValue(page([]));
    await openPage();
    expect(await screen.findByText('No entries match.')).toBeInTheDocument();
  });
});
