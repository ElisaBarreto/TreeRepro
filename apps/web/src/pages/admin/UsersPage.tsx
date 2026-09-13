import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { USER_STATUSES, type User, type UserStatus } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { adminKeys, listUsers } from '../../api/admin.ts';
import { InviteUserDialog } from '../../components/admin/InviteUserDialog.tsx';
import { UserStatusBadge } from '../../components/admin/UserStatusBadge.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { isoDate } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const DASH = <span className="text-mist-500">—</span>;

type Notice = { tone: 'success' | 'error'; text: string } | null;

/**
 * Everyone with an account, newest first (the API's order, RFC-50 R2),
 * filtered by status; "Invite user" with `users.invite`.
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-50 R2, R3
 */
export function UsersPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const statusId = useId();
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const filter = { status: status || undefined };
  const list = usePagedList(adminKeys.users(filter), (cursor, limit) =>
    listUsers({ ...filter, cursor, limit }),
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with an account, newest first."
        actions={
          hasPermission(me, 'users.invite') ? (
            <Button onClick={() => setInviting(true)}>Invite user</Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-6">
        <div className="max-w-xs">
          <Field id={statusId} label="Status">
            <Select
              id={statusId}
              value={status}
              onChange={(event) => setStatus(event.target.value as UserStatus | '')}
            >
              <option value="">All</option>
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No users match." />
        ) : null}
        {list.items.length > 0 ? <UserTable items={list.items} /> : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
      {inviting ? (
        <InviteUserDialog
          onClose={() => setInviting(false)}
          onInvited={(user, mailFailed) => {
            setInviting(false);
            setNotice(
              mailFailed
                ? {
                    tone: 'error',
                    text: 'The user was created but the invitation email failed. Open the user and use Resend invitation.',
                  }
                : { tone: 'success', text: `Invitation sent to ${user?.email}.` },
            );
            void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
          }}
        />
      ) : null}
    </>
  );
}

function UserTable({ items }: { items: User[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Name</Th>
          <Th>Email</Th>
          <Th>Status</Th>
          <Th>Roles</Th>
          <Th>Created</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((user) => (
          <Tr key={user.id}>
            <Td>
              <Link
                to="/app/admin/users/$id"
                params={{ id: user.id }}
                className="font-medium text-canopy-900 underline-offset-2 hover:underline"
              >
                {user.name}
              </Link>
            </Td>
            <Td>{user.email}</Td>
            <Td>
              <UserStatusBadge status={user.status} />
            </Td>
            <Td>{user.roles.length > 0 ? user.roles.map((r) => r.name).join(', ') : DASH}</Td>
            <Td className="whitespace-nowrap">{isoDate(user.createdAt)}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
