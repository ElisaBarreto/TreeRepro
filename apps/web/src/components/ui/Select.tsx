import type { SelectHTMLAttributes } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** The native select, dressed like `Input`; `className` replaces the default full width. @rfc RFC-13 R5 */
export function Select({ invalid = false, className = 'w-full', ...rest }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={`h-11 rounded-[10px] border bg-white px-3.5 text-body text-canopy-950 outline-none transition-colors focus:border-pollen-500 focus:ring-[3px] focus:ring-pollen-500/25 ${invalid ? 'border-red-600' : 'border-canopy-700/25'} ${className}`}
      {...rest}
    />
  );
}
