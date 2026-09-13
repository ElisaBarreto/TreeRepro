import type { InputHTMLAttributes, ReactNode } from 'react';

/**
 * The dark card of the public pages: same ground as the landing page, no
 * pollen and no emblem — motion stays on `/` (RFC-13 R7).
 * @rfc RFC-13 R2, R7
 */
export function AuthFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,var(--color-canopy-950)_0%,var(--color-canopy-700)_52%,var(--color-pollen-600)_100%)] px-4 py-6 text-mist-50">
      <section className="flex w-[480px] max-w-full flex-col gap-8 rounded-[22px] border border-white/10 bg-canopy-900/90 px-6 py-10 shadow-[0_30px_60px_rgba(0,0,0,0.45)] md:px-12">
        <header className="flex flex-col gap-1.5">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-mist-400">
            TreeRepro
          </p>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-white">{title}</h1>
          {subtitle ? <p className="text-sm text-mist-300">{subtitle}</p> : null}
        </header>
        {children}
      </section>
    </main>
  );
}

/** Input styled for the dark card. @rfc RFC-13 R5 */
export function DarkInput({
  invalid = false,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`h-11 w-full rounded-lg border bg-white/5 px-3 text-[15px] text-white outline-none transition-colors placeholder:text-mist-500 focus:border-pollen-500 ${invalid ? 'border-red-400' : 'border-white/15'} ${className}`}
      {...rest}
    />
  );
}

/** Label + control + error for the dark card. @rfc RFC-13 R6 */
export function DarkField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-mist-300">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-mist-400">{hint}</p> : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  );
}

/** Amber submit for the dark card. @rfc RFC-13 R5 */
export function DarkSubmit({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="inline-flex h-[46px] items-center justify-center rounded-full bg-pollen-500 px-7 font-display text-sm font-bold uppercase tracking-[0.08em] text-ink transition-colors hover:bg-pollen-400 disabled:cursor-progress disabled:opacity-70"
    >
      {children}
    </button>
  );
}

/** Error line for the dark card. @rfc RFC-13 R6 */
export function DarkAlert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className="rounded-lg border border-pollen-500/30 bg-pollen-500/10 px-3 py-2 text-sm text-pollen-300"
    >
      {children}
    </p>
  );
}
