import { Children, cloneElement, isValidElement, type ReactNode } from 'react';

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/**
 * Label, control, hint and error; the control must carry `id` so the label
 * and the descriptions attach to it. Pass `invalid` to the control yourself.
 * The single child is cloned with `aria-describedby` so the hint/error ids
 * land on the control itself, not a wrapper — that is what makes them count
 * as the control's accessible description.
 * @rfc RFC-13 R5, R6
 */
export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = Children.map(children, (child) =>
    isValidElement<{ 'aria-describedby'?: string }>(child) && describedBy
      ? cloneElement(child, {
          'aria-describedby': [child.props['aria-describedby'], describedBy]
            .filter(Boolean)
            .join(' '),
        })
      : child,
  );
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="text-label font-bold uppercase tracking-[0.08em] text-canopy-800"
      >
        {label}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="text-meta text-mist-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-meta text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
