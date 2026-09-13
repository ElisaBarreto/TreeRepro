import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type MeResponse,
  recoveryCodeSchema,
  type TotpDisableBody,
  totpCodeSchema,
} from '@treerepro/contracts';
import { toCanvas } from 'qrcode';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { totpConfirm, totpDisable, totpSetup } from '../../api/auth.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, GENERIC_MESSAGE, isValidationError } from '../../lib/errors.ts';
import { ME_QUERY_KEY, useMe } from '../../lib/session.ts';
import { Alert, Button, Dialog, Field, Input } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function totpErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  switch (error.code) {
    case 'AUTH_TOTP_INVALID':
      return 'That code is not valid.';
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Your password is incorrect.';
    case 'AUTH_TOTP_ALREADY_ENABLED':
      return 'Two-factor authentication is already on.';
    case 'AUTH_TOTP_NOT_ENABLED':
      return 'Two-factor authentication is already off.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    default:
      return GENERIC_MESSAGE;
  }
}

/**
 * Draws the otpauth URI into a canvas. qrcode's canvas renderer also sets
 * `style.width/height`, which lands as a `style` attribute; it is removed once
 * the drawing is done and `size-48` carries the layout size (RFC-13 R5).
 * @rfc RFC-23 R2
 */
function QrCanvas({ uri }: { uri: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    toCanvas(el, uri, { width: 192, margin: 1 })
      .then(() => el.removeAttribute('style'))
      // The secret text rendered below the canvas is the fallback if this never resolves.
      .catch(() => {});
  }, [uri]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="QR code for your authenticator app"
      className="size-48 rounded-lg bg-white"
    />
  );
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'setup'; secret: string; otpauthUri: string }
  | { kind: 'codes'; codes: string[] };

/**
 * Enabling sets both the session flag and the recovery-codes stage at once,
 * so the codes must render before the "on" branch checks the flag — otherwise
 * they would never be shown. Order: codes, then setup, then the flag.
 * @rfc RFC-23 R2, R3, R5, R7
 */
export function TotpSection() {
  const me = useMe();
  const queryClient = useQueryClient();
  const ids = { code: useId(), password: useId(), disableCode: useId() };
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [disabling, setDisabling] = useState(false);
  const [codeFieldError, setCodeFieldError] = useState<string | null>(null);
  const [disableFieldErrors, setDisableFieldErrors] = useState<{
    password?: string;
    code?: string;
  }>({});
  const disableFormRef = useRef<HTMLFormElement>(null);
  const setEnabled = (totpEnabled: boolean) =>
    queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, (old) =>
      old ? { ...old, user: { ...old.user, totpEnabled } } : old,
    );

  // gcTime 0: the secret and the recovery codes in these mutations' `data`
  // leave the MutationCache as soon as they are reset, not five minutes later.
  const setup = useMutation({
    mutationFn: () => totpSetup(),
    gcTime: 0,
    onSuccess: (data) => setStage({ kind: 'setup', ...data }),
  });
  const confirm = useMutation({
    mutationFn: (code: string) => totpConfirm(code),
    gcTime: 0,
    onSuccess: (codes) => {
      setEnabled(true);
      setStage({ kind: 'codes', codes });
    },
  });

  const disable = useMutation({
    mutationFn: (body: TotpDisableBody) => totpDisable(body),
    onSuccess: () => {
      setEnabled(false);
      closeDisable();
    },
  });

  /** Drops the mutation's cached data (and any error) so the disable form's error and
   * password never linger past the flow that produced them. */
  function closeDisable() {
    disable.reset();
    setDisableFieldErrors({});
    disableFormRef.current?.reset();
    setDisabling(false);
  }

  /** Leaves the recovery-codes stage: both mutations' cached results (the enrolled secret
   * and the ten codes) are dropped, not just the visible stage. */
  function acknowledgeCodes() {
    setup.reset();
    confirm.reset();
    setStage({ kind: 'idle' });
  }

  function cancelSetup() {
    setup.reset();
    confirm.reset();
    setCodeFieldError(null);
    setStage({ kind: 'idle' });
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    if (!totpCodeSchema.safeParse(value).success) {
      setCodeFieldError('Enter the six-digit code from your authenticator app.');
      return;
    }
    setCodeFieldError(null);
    confirm.mutate(value);
  }

  function submitDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const value = String(form.get('code') ?? '').trim();
    const errors: { password?: string; code?: string } = {};
    if (!password) errors.password = 'Enter your password.';
    let body: TotpDisableBody | undefined;
    if (totpCodeSchema.safeParse(value).success) body = { password, code: value };
    else if (recoveryCodeSchema.safeParse(value).success) body = { password, recoveryCode: value };
    else errors.code = 'Enter a six-digit code or a recovery code.';
    setDisableFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !body) return;
    disable.mutate(body);
  }

  const codeServerError = isValidationError(confirm.error)
    ? fieldErrors(confirm.error).code
    : undefined;
  const codeError = codeFieldError ?? codeServerError;

  const disableServerErrors = isValidationError(disable.error) ? fieldErrors(disable.error) : {};
  const passwordError = disableFieldErrors.password ?? disableServerErrors.password;
  const disableCodeError =
    disableFieldErrors.code ?? disableServerErrors.code ?? disableServerErrors.recoveryCode;

  return (
    <section aria-labelledby="totp-heading" className="flex flex-col gap-4">
      <h2 id="totp-heading" className="font-display text-lg font-bold">
        Two-factor authentication
      </h2>
      {stage.kind === 'codes' ? (
        <div className="flex max-w-md flex-col gap-4">
          <Alert tone="info">
            Save these recovery codes somewhere safe. Each works once; they are shown only now.
          </Alert>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {stage.codes.map((code) => (
              <li key={code} className="rounded bg-mist-50 px-3 py-1.5">
                {code}
              </li>
            ))}
          </ul>
          <div>
            <Button onClick={acknowledgeCodes}>I saved these codes</Button>
          </div>
        </div>
      ) : stage.kind === 'setup' ? (
        <form onSubmit={submitCode} className="flex max-w-md flex-col gap-4" noValidate>
          <p className="text-sm text-canopy-800">
            Scan the code with your authenticator app, or enter the secret by hand, then type the
            six-digit code it shows.
          </p>
          <QrCanvas uri={stage.otpauthUri} />
          <p className="font-mono text-sm tracking-wider">{stage.secret}</p>
          <Field id={ids.code} label="Verification code" error={codeError}>
            <Input
              id={ids.code}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              invalid={Boolean(codeError)}
              required
            />
          </Field>
          {confirm.isError && !isValidationError(confirm.error) ? (
            <Alert tone="error">{totpErrorMessage(confirm.error)}</Alert>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" pending={confirm.isPending}>
              Turn on
            </Button>
            <Button variant="secondary" onClick={cancelSetup}>
              Cancel
            </Button>
          </div>
        </form>
      ) : me.user.totpEnabled ? (
        <>
          <p className="text-sm text-canopy-800">Two-factor authentication is on.</p>
          <div>
            <Button variant="secondary" onClick={() => setDisabling(true)}>
              Disable
            </Button>
          </div>
          <Dialog open={disabling} title="Disable two-factor authentication" onClose={closeDisable}>
            <form
              ref={disableFormRef}
              onSubmit={submitDisable}
              className="flex flex-col gap-4"
              noValidate
            >
              <Field id={ids.password} label="Password" error={passwordError}>
                <Input
                  id={ids.password}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  invalid={Boolean(passwordError)}
                  required
                />
              </Field>
              <Field id={ids.disableCode} label="Code or recovery code" error={disableCodeError}>
                <Input
                  id={ids.disableCode}
                  name="code"
                  autoComplete="one-time-code"
                  invalid={Boolean(disableCodeError)}
                  required
                />
              </Field>
              {disable.isError && !isValidationError(disable.error) ? (
                <Alert tone="error">{totpErrorMessage(disable.error)}</Alert>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeDisable}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger" pending={disable.isPending}>
                  Disable two-factor
                </Button>
              </div>
            </form>
          </Dialog>
        </>
      ) : (
        <>
          <p className="text-sm text-canopy-800">Two-factor authentication is off.</p>
          {setup.isError ? <Alert tone="error">{totpErrorMessage(setup.error)}</Alert> : null}
          <div>
            <Button onClick={() => setup.mutate()} pending={setup.isPending}>
              Set up
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
