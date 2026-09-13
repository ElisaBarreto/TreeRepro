import { DarkField, DarkInput } from './AuthFrame.tsx';

/** @rfc RFC-21 R2 */
export const PASSWORD_HINT = 'At least 12 characters; a passphrase works well.';

/** @rfc RFC-21 R2 */
export function readPasswords(form: FormData): { password: string; confirm: string } {
  return {
    password: String(form.get('password') ?? ''),
    confirm: String(form.get('confirm') ?? ''),
  };
}

/** New password and its confirmation, for invitation and reset. @rfc RFC-13 R6 */
export function PasswordFields({
  ids,
  errors,
}: {
  ids: { password: string; confirm: string };
  errors: Record<string, string>;
}) {
  return (
    <>
      <DarkField
        id={ids.password}
        label="New password"
        hint={PASSWORD_HINT}
        error={errors.password}
      >
        <DarkInput
          id={ids.password}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          invalid={Boolean(errors.password)}
        />
      </DarkField>
      <DarkField id={ids.confirm} label="Confirm password" error={errors.confirm}>
        <DarkInput
          id={ids.confirm}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          invalid={Boolean(errors.confirm)}
        />
      </DarkField>
    </>
  );
}
