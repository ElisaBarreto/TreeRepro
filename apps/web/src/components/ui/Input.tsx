import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** @rfc RFC-13 R5 */
export function Input({ invalid = false, className = '', ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`h-10 w-full rounded-lg border bg-white px-3 text-[15px] text-canopy-950 outline-none transition-colors placeholder:text-mist-500 focus:border-pollen-500 ${invalid ? 'border-red-600' : 'border-canopy-700/25'} ${className}`}
      {...rest}
    />
  );
}
