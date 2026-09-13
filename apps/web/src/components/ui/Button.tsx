import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'md' | 'sm';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-display font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500 disabled:cursor-not-allowed disabled:opacity-60';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-pollen-500 text-ink hover:bg-pollen-400',
  secondary: 'border border-canopy-700/30 bg-white text-canopy-900 hover:bg-mist-50',
  danger: 'bg-red-700 text-white hover:bg-red-600',
};

// `md` is the page action (44px); `sm` sits inside table rows and the top bar.
const SIZES: Record<ButtonSize, string> = {
  md: 'h-11 px-5 text-cell',
  sm: 'h-9 px-3.5 text-meta',
};

/**
 * The Button's classes for an element that is not a `<button>` — a router
 * `Link` (`ButtonLink`) or an `<a download>` — so every action looks the same.
 * @rfc RFC-13 R5
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} = {}): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and marks it busy while a request runs. */
  pending?: boolean;
}

/** @rfc RFC-13 R5 */
export function Button({
  variant = 'primary',
  size = 'md',
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
      className={`${buttonClassName({ variant, size })} ${className}`}
      {...rest}
    />
  );
}
