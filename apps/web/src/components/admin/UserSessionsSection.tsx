import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminKeys,
  listUserSessions,
  revokeAllUserSessions,
  revokeUserSession,
} from '../../api/admin.ts';
import { formatDateTime } from '../../lib/format.ts';
import {
  Alert,
  Button,
  EmptyState,
  Section,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui/index.ts';
import { userErrorMessage } from './user-errors.ts';

/**
 * Every active session of a user, for `sessions.read`; per-row "Sign out"
 * and "Sign out everywhere" only with `sessions.revoke` (no buttons at all
 * otherwise). A session here is never the caller's own, so unlike
 * `SessionsSection` there is no "This device" badge.
 * @rfc RFC-50 R9
 * @rfc RFC-13 R3
 */
export function UserSessionsSection({ userId, canRevoke }: { userId: string; canRevoke: boolean }) {
  const queryClient = useQueryClient();
  const key = adminKeys.userSessions(userId);
  const sessions = useQuery({ queryKey: key, queryFn: () => listUserSessions(userId) });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeUserSession(userId, id),
    // onSettled, not onSuccess: a failed revoke (the session may already have
    // expired server-side) still resyncs the list against the server.
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const everywhere = useMutation({
    mutationFn: () => revokeAllUserSessions(userId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <Section id="sessions" title="Sessions" description="Every device signed in as this user.">
      {sessions.isError ? <Alert tone="error">{userErrorMessage(sessions.error)}</Alert> : null}
      {revoke.isError || everywhere.isError ? (
        <Alert tone="error">{userErrorMessage(revoke.error ?? everywhere.error)}</Alert>
      ) : null}
      {sessions.data && sessions.data.length === 0 ? (
        <EmptyState title="No active sessions." />
      ) : null}
      {sessions.data && sessions.data.length > 0 ? (
        <Table>
          <Thead>
            <Tr>
              <Th>Device</Th>
              <Th>IP</Th>
              <Th>Last seen</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {sessions.data.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <span className="block max-w-xs truncate" title={s.userAgent}>
                    {s.userAgent}
                  </span>
                </Td>
                <Td>{s.ip}</Td>
                <Td>{formatDateTime(s.lastSeenAt)}</Td>
                <Td className="text-right">
                  {canRevoke ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Sign out ${s.userAgent}`}
                      pending={revoke.isPending && revoke.variables === s.id}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      Sign out
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
      {canRevoke ? (
        <div>
          <Button
            variant="danger"
            pending={everywhere.isPending}
            onClick={() => everywhere.mutate()}
          >
            Sign out everywhere
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
