import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { changePassword } from '../../api/auth.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, GENERIC_MESSAGE, isValidationError } from '../../lib/errors.ts';
import { PASSWORD_HINT } from '../auth/PasswordFields.tsx';
import { Alert, Button, Field, Input, Section } from '../ui/index.ts';
import { API_KEYS_QUERY_KEY, RevokesApiKeysNote } from './ApiKeysSection.tsx';

/** @rfc RFC-13 R6 */
export function passwordErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  switch (error.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Your current password is incorrect.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    default:
      return GENERIC_MESSAGE;
  }
}

/**
 * The call goes through `useMutation` like every other request under `/app`,
 * so the MutationCache's 401 handler sees a lost session (RFC-13 R4).
 * @rfc RFC-21 R7
 */
export function PasswordSection() {
  const ids = { current: useId(), next: useId(), confirm: useId() };
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change = useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) =>
      changePassword(vars.currentPassword, vars.newPassword),
    // gcTime 0: the two passwords sit in the mutation's `variables`; they
    // leave the MutationCache with the section, not five minutes later.
    gcTime: 0,
    onSuccess: () => {
      setDone(true);
      formRef.current?.reset();
      // The change revoked every API key (RFC-82 R3).
      void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
    onError: (error) => {
      if (isValidationError(error)) {
        // AUTH_PASSWORD_WEAK names the field `password` for every flow
        // (apps/api/src/auth/password.ts, passwordWeakError); show it under
        // the new-password field, which is the one it is about here.
        const { password, ...fe } = fieldErrors(error);
        const newPassword = fe.newPassword ?? password;
        setErrors(newPassword === undefined ? fe : { ...fe, newPassword });
      } else if (error instanceof ApiError && error.code === 'AUTH_INVALID_CREDENTIALS') {
        setErrors({ currentPassword: passwordErrorMessage(error) });
      } else setErrors({ form: passwordErrorMessage(error) });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    const confirm = String(data.get('confirm') ?? '');
    setDone(false);
    if (newPassword !== confirm) {
      setErrors({ confirm: 'The passwords do not match.' });
      return;
    }
    setErrors({});
    // gcTime 0 only takes effect once the observer detaches; while the
    // section stays mounted, resetting on settle is what drops the two
    // passwords out of the mutation's `variables` right away (RFC-21 R7).
    change.mutate({ currentPassword, newPassword }, { onSettled: () => change.reset() });
  }

  return (
    <Section id="password" title="Password" description="Changing it signs out every other device.">
      <form ref={formRef} onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
        <RevokesApiKeysNote />
        <Field id={ids.current} label="Current password" error={errors.currentPassword}>
          <Input
            id={ids.current}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            invalid={Boolean(errors.currentPassword)}
          />
        </Field>
        <Field id={ids.next} label="New password" hint={PASSWORD_HINT} error={errors.newPassword}>
          <Input
            id={ids.next}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            invalid={Boolean(errors.newPassword)}
          />
        </Field>
        <Field id={ids.confirm} label="Confirm password" error={errors.confirm}>
          <Input
            id={ids.confirm}
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            invalid={Boolean(errors.confirm)}
          />
        </Field>
        {done ? (
          <Alert tone="success">Password changed. Other devices were signed out.</Alert>
        ) : null}
        {errors.form ? <Alert tone="error">{errors.form}</Alert> : null}
        <div>
          <Button type="submit" pending={change.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}
