import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const BASE =
  'inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 font-display text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500 disabled:cursor-not-allowed disabled:opacity-60';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-pollen-500 text-ink hover:bg-pollen-400',
  secondary: 'border border-canopy-700/30 bg-white text-canopy-900 hover:bg-mist-50',
  danger: 'bg-red-700 text-white hover:bg-red-600',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Disables the button and marks it busy while a request runs. */
  pending?: boolean;
}

/** @rfc RFC-13 R5 */
export function Button({
  variant = 'primary',
  pending = false,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
