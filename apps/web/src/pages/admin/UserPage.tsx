import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@treerepro/contracts';
import { useState } from 'react';
import {
  adminKeys,
  fetchUser,
  reactivateUser,
  resendInvite,
  suspendUser,
} from '../../api/admin.ts';
import { UserNameSection } from '../../components/admin/UserNameSection.tsx';
import { UserPlotsSection } from '../../components/admin/UserPlotsSection.tsx';
import { UserRolesSection } from '../../components/admin/UserRolesSection.tsx';
import { UserSessionsSection } from '../../components/admin/UserSessionsSection.tsx';
import { UserStatusBadge } from '../../components/admin/UserStatusBadge.tsx';
import { userErrorMessage } from '../../components/admin/user-errors.ts';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  ConfirmDialog,
  PageHeader,
} from '../../components/ui/index.ts';
import { detailErrorMessage } from '../../lib/errors.ts';
import { isoDate } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

type Pending = 'suspend' | 'reactivate' | null;

/**
 * One user: the header facts, then the sections the session's permissions
 * allow (name and roles with `users.update` — roles read-only on the viewer's
 * own page, RFC-31 R13 —, sessions with `sessions.read`);
 * suspend / reactivate (`users.suspend`) behind a confirmation, resend
 * invitation (`users.invite`) for an invited user. Every write puts the
 * answered user in the detail cache and refreshes the lists.
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-50 R4, R6, R7, R8
 * @rfc RFC-71 R5
 * @rfc RFC-31 R13
 */
export function UserPage({ id }: { id: string }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<Pending>(null);
  const user = useQuery({ queryKey: adminKeys.user(id), queryFn: () => fetchUser(id) });
  const settle = (next: User) => {
    queryClient.setQueryData(adminKeys.user(id), next);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  };
  const suspend = useMutation({
    mutationFn: () => suspendUser(id),
    onSuccess: (u) => {
      settle(u);
      setConfirming(null);
    },
  });
  const reactivate = useMutation({
    mutationFn: () => reactivateUser(id),
    onSuccess: (u) => {
      settle(u);
      setConfirming(null);
    },
  });
  const resend = useMutation({ mutationFn: () => resendInvite(id), onSuccess: settle });

  if (user.isPending) return <p className="text-body text-mist-500">Loading…</p>;
  if (user.isError) {
    return (
      <Alert tone="error">
        {detailErrorMessage(user.error, 'USER_NOT_FOUND', 'This user does not exist.')}
      </Alert>
    );
  }
  const u = user.data;
  const canSuspend = hasPermission(me, 'users.suspend');
  const canInvite = hasPermission(me, 'users.invite');
  const canUpdate = hasPermission(me, 'users.update');
  const canReadContributions = hasPermission(me, 'contributions.read');

  return (
    <>
      <PageHeader
        title={u.name}
        description={u.email}
        actions={
          <>
            {canReadContributions ? (
              <ButtonLink to="/app/contributions" search={{ userId: u.id }}>
                View contributions
              </ButtonLink>
            ) : null}
            {canInvite && u.status === 'invited' ? (
              <Button
                variant="secondary"
                pending={resend.isPending}
                onClick={() => resend.mutate()}
              >
                Resend invitation
              </Button>
            ) : null}
            {canSuspend && u.status === 'active' ? (
              <Button variant="danger" onClick={() => setConfirming('suspend')}>
                Suspend
              </Button>
            ) : null}
            {canSuspend && u.status === 'suspended' ? (
              <Button onClick={() => setConfirming('reactivate')}>Reactivate</Button>
            ) : null}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <UserStatusBadge status={u.status} />
        <Badge>{u.totpEnabled ? 'Two-factor on' : 'Two-factor off'}</Badge>
        <Badge>{`Created ${isoDate(u.createdAt)}`}</Badge>
        {u.suspendedAt ? <Badge tone="red">{`Suspended ${isoDate(u.suspendedAt)}`}</Badge> : null}
      </div>
      {resend.isSuccess ? <Alert tone="success">{`Invitation sent to ${u.email}.`}</Alert> : null}
      {resend.isError ? <Alert tone="error">{userErrorMessage(resend.error)}</Alert> : null}
      {canUpdate ? <UserNameSection user={u} /> : null}
      {/* Nobody changes their own roles (RFC-31 R13): the API refuses it, so the page does not offer it. */}
      <UserRolesSection user={u} canEdit={canUpdate && u.id !== me.user.id} />
      <UserPlotsSection user={u} canEdit={canUpdate} />
      {hasPermission(me, 'sessions.read') ? (
        <UserSessionsSection userId={u.id} canRevoke={hasPermission(me, 'sessions.revoke')} />
      ) : null}
      {confirming === 'suspend' ? (
        <ConfirmDialog
          title={`Suspend ${u.name}?`}
          message="Every session of this user ends at once and sign-in is refused until the account is reactivated."
          confirmLabel="Suspend"
          danger
          pending={suspend.isPending}
          error={suspend.isError ? userErrorMessage(suspend.error) : null}
          onConfirm={() => suspend.mutate()}
          onClose={() => {
            suspend.reset();
            setConfirming(null);
          }}
        />
      ) : null}
      {confirming === 'reactivate' ? (
        <ConfirmDialog
          title={`Reactivate ${u.name}?`}
          message="The user can sign in again with the roles they had."
          confirmLabel="Reactivate"
          pending={reactivate.isPending}
          error={reactivate.isError ? userErrorMessage(reactivate.error) : null}
          onConfirm={() => reactivate.mutate()}
          onClose={() => {
            reactivate.reset();
            setConfirming(null);
          }}
        />
      ) : null}
    </>
  );
}
