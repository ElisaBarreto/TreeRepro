import type { InputHTMLAttributes, Ref } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** @rfc RFC-13 R5 */
export function Input({
  ref,
  invalid = false,
  className = '',
  readOnly,
  ...rest
}: InputProps & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      readOnly={readOnly}
      className={`h-11 w-full rounded-[10px] border px-3.5 text-body outline-none transition-colors placeholder:text-mist-500 focus:border-pollen-500 focus:ring-[3px] focus:ring-pollen-500/25 ${readOnly ? 'bg-mist-50 text-canopy-800' : 'bg-white text-canopy-950'} ${invalid ? 'border-red-600' : 'border-canopy-700/25'} ${className}`}
      {...rest}
    />
  );
}
