import { type FormEvent, useId, useState } from 'react';
import { resetPassword } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import { AuthFrame, DarkAlert, DarkSubmit } from '../components/auth/AuthFrame.tsx';
import { PasswordFields, readPasswords } from '../components/auth/PasswordFields.tsx';
import { fieldErrors, GENERIC_MESSAGE, isValidationError } from '../lib/errors.ts';

/** @rfc RFC-13 R6 */
export function resetErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  switch (error.code) {
    case 'AUTH_TOKEN_INVALID':
      return 'This link is no longer valid. Request a new one.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return GENERIC_MESSAGE;
  }
}

/** @rfc RFC-21 R6 */
export function ResetPasswordPage({ token }: { token: string }) {
  const ids = { password: useId(), confirm: useId() };
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
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
      await resetPassword(token, password);
      setDone(true);
    } catch (error) {
      if (isValidationError(error)) setErrors(fieldErrors(error));
      else setAlert(resetErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <AuthFrame title="Your password is changed.">
        <a
          href="/"
          className="inline-flex h-[46px] items-center justify-center rounded-full bg-pollen-500 px-7 font-display text-sm font-bold uppercase tracking-[0.08em] text-ink transition-colors hover:bg-pollen-400"
        >
          Sign in
        </a>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Choose a new password">
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <PasswordFields ids={ids} errors={errors} />
        {alert ? <DarkAlert tone="error">{alert}</DarkAlert> : null}
        <DarkSubmit pending={pending}>Change password</DarkSubmit>
      </form>
    </AuthFrame>
  );
}
