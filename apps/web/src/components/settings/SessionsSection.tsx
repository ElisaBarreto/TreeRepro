import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logoutAll } from '../../api/auth.ts';
import { listSessions, revokeSession } from '../../api/me.ts';
import { GENERIC_MESSAGE } from '../../lib/errors.ts';
import { ME_QUERY_KEY } from '../../lib/session.ts';
import { Alert, Badge, Button, EmptyState, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const SESSIONS_KEY = ['me', 'sessions'] as const;

/** @rfc RFC-13 R6 */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * `onSignedOutEverywhere` runs before the `me` query is dropped — the same
 * navigate-then-forget order as the 401 handler and the shell's sign-out —
 * because dropping the session while sibling settings sections still call
 * `useMe` would throw.
 * @rfc RFC-22 R9, R11
 */
export function SessionsSection({
  onSignedOutEverywhere,
}: {
  onSignedOutEverywhere?: () => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: listSessions });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
  const everywhere = useMutation({
    mutationFn: () => logoutAll(),
    onSuccess: async () => {
      await onSignedOutEverywhere?.();
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  return (
    <section aria-labelledby="sessions-heading" className="flex flex-col gap-4">
      <h2 id="sessions-heading" className="font-display text-lg font-bold">
        Sessions
      </h2>
      {sessions.isError ? <Alert tone="error">{GENERIC_MESSAGE}</Alert> : null}
      {revoke.isError || everywhere.isError ? <Alert tone="error">{GENERIC_MESSAGE}</Alert> : null}
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
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {sessions.data.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <span className="block max-w-xs truncate" title={s.userAgent}>
                    {s.userAgent}
                  </span>
                  {s.current ? <Badge tone="green">This device</Badge> : null}
                </Td>
                <Td>{s.ip}</Td>
                <Td>{formatWhen(s.lastSeenAt)}</Td>
                <Td className="text-right">
                  {s.current ? null : (
                    <Button
                      variant="secondary"
                      pending={revoke.isPending && revoke.variables === s.id}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      Sign out
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
      <div>
        <Button variant="danger" pending={everywhere.isPending} onClick={() => everywhere.mutate()}>
          Sign out everywhere
        </Button>
      </div>
    </section>
  );
}
