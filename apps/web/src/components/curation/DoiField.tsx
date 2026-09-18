import type { ResolveDoiResult } from '@treerepro/contracts';
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

/**
 * What `GET /api/references/resolve` left on a row: not found, or the line a
 * resolved DOI reads as. A known reference with a written or derived short
 * citation (RFC-61 R4, R6, R8) reads by it verbatim — the same string
 * `referenceLabel` would show everywhere else, already carrying its own
 * year when it has one. Otherwise: the title the registry previewed or the
 * one the known reference carries (its citation key if it has no title, the
 * DOI itself if it has neither), with the year. One rule, because every form
 * that checks a DOI shows the same line.
 * @rfc RFC-61 R4, R6, R8
 * @rfc RFC-80 R4
 */
export function resolvedCheck(result: ResolveDoiResult, doi: string): DoiCheck {
  if (result.status === 'not_found') return { status: 'not_found' };
  if (result.status === 'known' && result.reference.shortCitation) {
    return { status: 'ok', label: result.reference.shortCitation };
  }
  const preview = result.status === 'resolvable' ? result.preview : null;
  const reference = result.status === 'known' ? result.reference : null;
  const title = preview?.title ?? reference?.title ?? reference?.citationKey ?? doi;
  const year = preview?.year ?? reference?.year ?? null;
  return { status: 'ok', label: year === null ? title : `${title} (${year})` };
}

/**
 * Whether a check is a line that stops a form sending the DOI: the registry
 * does not know it, the API called its shape malformed, or the check never
 * landed. The API would refuse the record or the annotation either way, so
 * every form that holds a DOI asks this one question.
 * @rfc RFC-80 R4
 */
export function doiBlocks(check: DoiCheck): boolean {
  return check.status === 'not_found' || check.status === 'malformed' || check.status === 'failed';
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
  const blocking = doiBlocks(check);
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
