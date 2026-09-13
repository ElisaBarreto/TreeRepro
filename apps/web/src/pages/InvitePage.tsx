import { type FormEvent, useId, useState } from 'react';
import { acceptInvite } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import { AuthFrame, DarkAlert, DarkSubmit } from '../components/auth/AuthFrame.tsx';
import { PasswordFields, readPasswords } from '../components/auth/PasswordFields.tsx';
import { fieldErrors, GENERIC_MESSAGE, isValidationError } from '../lib/errors.ts';

/** @rfc RFC-13 R6 */
export function inviteErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  switch (error.code) {
    case 'AUTH_TOKEN_INVALID':
      return 'This invitation is no longer valid. Ask an administrator to send a new one.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return GENERIC_MESSAGE;
  }
}

/** @rfc RFC-20 R6 */
export function InvitePage({ token, onAccepted }: { token: string; onAccepted: () => void }) {
  const ids = { password: useId(), confirm: useId() };
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { password, confirm } = readPasswords(new FormData(event.currentTarget));
    setAlert(null);
    if (password !== confirm) {
      setErrors({ confirm: 'The passwords do not match.' });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await acceptInvite(token, password);
      onAccepted();
    } catch (error) {
      if (isValidationError(error)) setErrors(fieldErrors(error));
      else setAlert(inviteErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame title="Welcome to TreeRepro" subtitle="Choose a password to activate your account.">
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <PasswordFields ids={ids} errors={errors} />
        {alert ? <DarkAlert tone="error">{alert}</DarkAlert> : null}
        <DarkSubmit pending={pending}>Set password and sign in</DarkSubmit>
      </form>
    </AuthFrame>
  );
}
