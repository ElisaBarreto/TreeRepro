import type { AuthUser } from '@treerepro/contracts';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { login, loginTotp } from '../../api/auth.ts';
import { ApiError } from '../../api/client.ts';
import './landing.css';

interface LoginFormProps {
  onSignedIn: (user: AuthUser) => void;
}

type Step = 'credentials' | 'totp';

/**
 * Maps API error codes to one sentence for the person at the keyboard. Unknown
 * email and wrong password share a message on purpose (RFC-22 R2).
 * @rfc RFC-22 R2
 * @rfc RFC-23 R6
 * @rfc RFC-24 R2
 */
export function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Email or password is incorrect.';
    case 'AUTH_ACCOUNT_SUSPENDED':
      return 'This account is suspended. Contact your project coordinator.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    case 'AUTH_TOTP_INVALID':
      return 'That code is not valid. Check your authenticator and try again.';
    case 'AUTH_MFA_EXPIRED':
      return 'The verification window expired. Sign in again.';
    case 'VALIDATION_FAILED':
      return 'Enter a valid email address and your password.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/**
 * Email + password, then a verification code when the account has TOTP enabled.
 * Holds no session state: the parent decides what happens after `onSignedIn`.
 * @rfc RFC-10 R3
 * @rfc RFC-22 R2-R3
 * @rfc RFC-23 R6
 */
export function LoginForm({ onSignedIn }: LoginFormProps) {
  const [step, setStep] = useState<Step>('credentials');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const ids = { email: useId(), password: useId(), code: useId() };

  async function run(request: () => Promise<{ status: string; user?: AuthUser }>) {
    setPending(true);
    setError(null);
    try {
      const result = await request();
      if (result.status === 'totp_required') {
        setStep('totp');
      } else if (result.user) {
        onSignedIn(result.user);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'AUTH_MFA_EXPIRED') setStep('credentials');
      setError(loginErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    void run(() => login({ email, password }));
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '');
    void run(() => loginTotp(code));
  }

  const alert = error ? (
    <p
      role="alert"
      className="rounded-lg border border-pollen-500/30 bg-pollen-500/10 px-3 py-2 text-sm text-pollen-300"
    >
      {error}
    </p>
  ) : null;

  if (step === 'totp') {
    return (
      <form key="totp" onSubmit={submitCode} className="flex flex-col gap-7" noValidate>
        <Field
          id={ids.code}
          label="Verification code"
          hint="From your authenticator app, or one of your recovery codes."
          icon={<ShieldIcon />}
        >
          <input
            id={ids.code}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            className="w-full bg-transparent py-1 text-[15px] tracking-[0.2em] text-white outline-none placeholder:text-mist-500"
          />
        </Field>
        {alert}
        <div className="flex flex-col items-center gap-4 pt-2">
          <SubmitButton pending={pending}>Verify</SubmitButton>
          <button
            type="button"
            onClick={() => {
              setStep('credentials');
              setError(null);
            }}
            className="text-[13px] text-mist-200 transition-colors hover:text-pollen-500"
          >
            Back to sign in
          </button>
        </div>
      </form>
    );
  }

  return (
    <form key="credentials" onSubmit={submitCredentials} className="flex flex-col gap-7" noValidate>
      <Field id={ids.email} label="Email" icon={<MailIcon />}>
        <input
          id={ids.email}
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@institution.org"
          required
          className="w-full bg-transparent py-1 text-[15px] text-white outline-none placeholder:text-mist-500"
        />
      </Field>

      <Field
        id={ids.password}
        label="Password"
        icon={<LockIcon />}
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="flex rounded-md p-1 text-mist-400 transition-colors hover:text-white"
          >
            <EyeIcon off={showPassword} />
          </button>
        }
      >
        <input
          id={ids.password}
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder="Your password"
          required
          className="w-full bg-transparent py-1 text-[15px] text-white outline-none placeholder:text-mist-500"
        />
      </Field>

      {alert}

      <div className="flex justify-center pt-2">
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-[13px] text-mist-300">
        <a
          href="/forgot-password"
          className="text-mist-200 transition-colors hover:text-pollen-500"
        >
          Forgot your password?
        </a>
        <span className="inline-flex items-center gap-2">
          <LeafIcon />
          <span>Invitation only. Ask your project coordinator.</span>
        </span>
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}

function Field({ id, label, hint, icon, trailing, children }: FieldProps) {
  return (
    <div className="group relative flex flex-col gap-2 border-b border-white/18 pb-3 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-linear-to-r after:from-pollen-500 after:to-canopy-300 after:transition-transform after:duration-300 after:ease-out focus-within:after:scale-x-100">
      <label htmlFor={id} className="text-xs font-semibold tracking-[0.04em] text-mist-100">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <span className="flex text-mist-400 transition-colors group-focus-within:text-pollen-500">
          {icon}
        </span>
        {children}
        {trailing}
      </div>
      {hint ? <p className="text-xs text-mist-400">{hint}</p> : null}
    </div>
  );
}

function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="tr-cta relative isolate inline-flex h-[46px] min-w-[220px] items-center justify-center gap-2.5 overflow-hidden rounded-full px-7 font-display text-sm font-bold uppercase tracking-[0.08em] text-ink disabled:cursor-progress"
    >
      <span>{children}</span>
      <ArrowIcon />
    </button>
  );
}

const iconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function MailIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" {...iconProps}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" {...iconProps}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" {...iconProps}>
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...iconProps}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      {...iconProps}
      strokeWidth={2.2}
      className="tr-cta-arrow transition-transform duration-300"
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function LeafIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      {...iconProps}
      strokeWidth={2}
      className="text-canopy-300"
    >
      <path d="M4 20c0-8 6-14 16-16-1 10-7 16-16 16z" />
      <path d="M4 20c4-6 8-9 12-12" />
    </svg>
  );
}
