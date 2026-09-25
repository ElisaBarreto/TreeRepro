import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type CreateUserBody,
  createUserBodySchema,
  PERMISSION_KEYS,
  type Role,
  type User,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { adminKeys, inviteUser, listRoles } from '../../api/admin.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, isValidationError, pageErrorMessage } from '../../lib/errors.ts';
import { useMe } from '../../lib/session.ts';
import { Alert, Button, Dialog, Field, Input, Select } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function inviteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'USER_EMAIL_TAKEN':
        return 'Another account already uses this email.';
      case 'MAIL_SEND_FAILED':
        return 'The user was created but the invitation email failed. Open the user and use Resend invitation.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

const LOCAL_MESSAGES: Record<string, string> = {
  email: 'Enter a valid email address.',
  name: 'Enter a name (up to 120 characters).',
  roles: 'Choose a role.',
};

/**
 * The roles the actor may hand out: all of them for an admin (who alone
 * holds the whole catalog, RFC-32 R1, RFC-31 R15); otherwise never `admin`
 * and only roles whose stored permissions the actor all holds.
 * @rfc RFC-31 R12, R14
 */
export function assignableRoles(roles: Role[], permissions: readonly string[]): Role[] {
  if (PERMISSION_KEYS.every((key) => permissions.includes(key))) return roles;
  return roles.filter(
    (role) =>
      !(role.isSystem && role.name === 'admin') &&
      role.permissions.every((key) => permissions.includes(key)),
  );
}

/**
 * Email, name and role; `POST /api/admin/users`. Only the roles within the
 * actor's delegation ceiling are offered (RFC-31 R14). A `MAIL_SEND_FAILED` answer still
 * created the user (RFC-50 R3), so the dialog closes and the page says how
 * to resend; `USER_EMAIL_TAKEN` stays under the email field. Mounted only
 * while open.
 * @rfc RFC-50 R3
 * @rfc RFC-13 R6
 * @rfc RFC-31 R14
 */
export function InviteUserDialog({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (user: User | null, mailFailed: boolean) => void;
}) {
  const me = useMe();
  const ids = { email: useId(), name: useId(), role: useId() };
  const roles = useQuery({ queryKey: adminKeys.roles, queryFn: listRoles });
  const offered = assignableRoles(roles.data ?? [], me.permissions);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const invite = useMutation({
    mutationFn: (body: CreateUserBody) => inviteUser(body),
    onSuccess: (user) => onInvited(user, false),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'MAIL_SEND_FAILED') onInvited(null, true);
    },
  });
  const serverErrors = fieldErrors(invite.error);
  const emailError =
    localErrors.email ??
    serverErrors.email ??
    (invite.error instanceof ApiError && invite.error.code === 'USER_EMAIL_TAKEN'
      ? inviteErrorMessage(invite.error)
      : undefined);
  const nameError = localErrors.name ?? serverErrors.name;
  const roleError = localErrors.roles ?? serverErrors.roles;
  const formError =
    invite.isError &&
    !isValidationError(invite.error) &&
    !(invite.error instanceof ApiError && invite.error.code === 'USER_EMAIL_TAKEN')
      ? inviteErrorMessage(invite.error)
      : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createUserBodySchema.safeParse({
      email: String(form.get('email') ?? ''),
      name: String(form.get('name') ?? ''),
      roles: form.get('role') ? [String(form.get('role'))] : [],
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] = LOCAL_MESSAGES[key] ?? issue.message;
      }
      invite.reset();
      setLocalErrors(next);
      return;
    }
    setLocalErrors({});
    invite.mutate(parsed.data);
  }

  return (
    <Dialog open title="Invite user" onClose={onClose} closeDisabled={invite.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={ids.email} label="Email" error={emailError}>
          <Input
            id={ids.email}
            name="email"
            type="email"
            autoComplete="off"
            maxLength={254}
            invalid={Boolean(emailError)}
          />
        </Field>
        <Field id={ids.name} label="Name" error={nameError}>
          <Input
            id={ids.name}
            name="name"
            autoComplete="off"
            maxLength={120}
            invalid={Boolean(nameError)}
          />
        </Field>
        <Field id={ids.role} label="Role" error={roleError}>
          <Select
            id={ids.role}
            name="role"
            defaultValue=""
            disabled={!roles.data}
            invalid={Boolean(roleError)}
          >
            <option value="" disabled>
              Choose a role
            </option>
            {offered.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </Field>
        {roles.isError ? <Alert tone="error">{pageErrorMessage(roles.error)}</Alert> : null}
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={invite.isPending}>
            Send invitation
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
