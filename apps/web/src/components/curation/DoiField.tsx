import { Button, Field, Icon, type IconName, Input } from '../ui/index.ts';

/** What the DOI resolve answered for one row; `ok` carries the line to show. */
export type DoiCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; label: string }
  | { status: 'not_found' }
  | { status: 'malformed' }
  | { status: 'failed' };

export interface DoiFieldProps {
  id: string;
  value: string;
  onChange(v: string): void;
  check: DoiCheck;
  /** Asks the owner to check this row; the row has lost focus. */
  onBlur(): void;
  /** Absent while the row cannot be removed (a form always keeps one row). */
  onRemove?: () => void;
  /** The API's message for this row (`sources.references.<i>.doi`). */
  error?: string;
  /** Tells the rows of one field apart ("DOI", "DOI 2", …); "DOI" by default. */
  label?: string;
}

function statusLine(check: DoiCheck): { icon: IconName; text: string; className: string } | null {
  switch (check.status) {
    case 'idle':
      return null;
    case 'checking':
      return { icon: 'info', text: 'Checking…', className: 'text-mist-500' };
    case 'ok':
      return { icon: 'check', text: `Resolved: ${check.label}`, className: 'text-canopy-900' };
    case 'not_found':
      return { icon: 'alert', text: 'DOI not found', className: 'text-red-700' };
    case 'malformed':
      return { icon: 'alert', text: 'Malformed DOI', className: 'text-red-700' };
    case 'failed':
      return {
        icon: 'alert',
        text: 'Could not check the DOI — try again',
        className: 'text-red-700',
      };
  }
}

/**
 * One DOI of a claim's sources (RFC-80 R4): the field, its remove button, and
 * the line the live check left — resolved with the reference's title, or one
 * of the three sentences that block the form (not found, malformed, check
 * failed). The check itself belongs to {@link SourcesField}, which also
 * carries the hint about leaving a DOI out: that is about having no source at
 * all, which no single row can say. This field only reports that it lost
 * focus. The status line is a live region that is always mounted, empty while
 * there is nothing to say, so a check that lands after the cursor has moved on
 * is still announced — assistive technology ignores a region that appears
 * together with its text.
 * @rfc RFC-80 R4
 */
export function DoiField({
  id,
  value,
  onChange,
  check,
  onBlur,
  onRemove,
  error,
  label = 'DOI',
}: DoiFieldProps) {
  const line = statusLine(check);
  const blocking =
    check.status === 'not_found' || check.status === 'malformed' || check.status === 'failed';
  return (
    <div className="flex flex-col gap-1">
      <Field
        id={id}
        label={label}
        error={error}
        trailing={
          onRemove ? (
            <Button variant="secondary" size="sm" onClick={onRemove}>
              Remove
            </Button>
          ) : undefined
        }
      >
        <Input
          id={id}
          value={value}
          maxLength={300}
          placeholder="10.1111/geb.13000"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          invalid={Boolean(error) || blocking}
        />
      </Field>
      <p
        role="status"
        className={`flex items-center gap-1.5 text-meta ${line ? line.className : ''}`}
      >
        {line ? (
          <>
            <Icon name={line.icon} size={16} />
            <span>{line.text}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
