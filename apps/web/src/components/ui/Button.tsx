import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'md' | 'sm';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-display font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500 disabled:cursor-not-allowed disabled:opacity-60';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-pollen-500 text-ink hover:bg-pollen-400',
  secondary: 'border border-canopy-700/30 bg-white text-canopy-900 hover:bg-mist-50',
  danger: 'bg-red-700 text-white hover:bg-red-600',
};

// `md` is the page action (44px); `sm` sits inside table rows and the top bar.
const SIZES: Record<Size, string> = {
  md: 'h-11 px-5 text-cell',
  sm: 'h-9 px-3.5 text-meta',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
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
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
