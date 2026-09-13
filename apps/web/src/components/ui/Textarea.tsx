import type { TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Multi-line `Input`: the same dress, `rows` instead of the fixed height. @rfc RFC-13 R5 */
export function Textarea({ invalid = false, className = '', rows = 3, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={`w-full rounded-[10px] border bg-white px-3.5 py-2.5 text-body text-canopy-950 outline-none transition-colors placeholder:text-mist-500 focus:border-pollen-500 focus:ring-[3px] focus:ring-pollen-500/25 ${invalid ? 'border-red-600' : 'border-canopy-700/25'} ${className}`}
      {...rest}
    />
  );
}
