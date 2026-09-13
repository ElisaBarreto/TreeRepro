import { emailSchema } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { forgotPassword } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import {
  AuthFrame,
  DarkAlert,
  DarkField,
  DarkInput,
  DarkSubmit,
} from '../components/auth/AuthFrame.tsx';
import { GENERIC_MESSAGE } from '../lib/errors.ts';

const SENT = 'If that email has an account, a reset link is on its way.';

/** @rfc RFC-13 R6 */
export function forgotErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  switch (error.code) {
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return GENERIC_MESSAGE;
  }
}

/** @rfc RFC-21 R5 */
export function ForgotPasswordPage() {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'sent' } | { kind: 'error'; message: string } | { kind: 'invalid' }
  >({ kind: 'idle' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (!emailSchema.safeParse(email).success) {
      setState({ kind: 'invalid' });
      return;
    }
    setPending(true);
    try {
      await forgotPassword(email);
      setState({ kind: 'sent' });
    } catch (error) {
      setState({ kind: 'error', message: forgotErrorMessage(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame
      title="Forgot your password?"
      subtitle="We will email you a link to choose a new one."
    >
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <DarkField
          id={id}
          label="Email"
          error={state.kind === 'invalid' ? 'Enter a valid email address.' : undefined}
        >
          <DarkInput
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            required
            invalid={state.kind === 'invalid'}
          />
        </DarkField>
        {state.kind === 'sent' ? <DarkAlert tone="success">{SENT}</DarkAlert> : null}
        {state.kind === 'error' ? <DarkAlert tone="error">{state.message}</DarkAlert> : null}
        <DarkSubmit pending={pending}>Send reset link</DarkSubmit>
        <a
          href="/"
          className="text-center text-[13px] text-mist-200 transition-colors hover:text-pollen-500"
        >
          Back to sign in
        </a>
      </form>
    </AuthFrame>
  );
}
