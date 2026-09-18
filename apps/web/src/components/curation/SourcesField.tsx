import type { CreateRecordBody, ResolveDoiResult } from '@treerepro/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { resolveDoi } from '../../api/curation.ts';
import { helpHref } from '../../content/help/href.ts';
import { Button, HelpTip } from '../ui/index.ts';
import { type DoiCheck, DoiField, resolvedCheck } from './DoiField.tsx';

/** The DOIs of a claim's sources, one per row; `''` rows are blank ones. */
export type SourcesValue = { dois: string[] };

export interface SourcesFieldProps {
  value: SourcesValue;
  onChange(v: SourcesValue): void;
  /** Field errors keyed by the API's paths (`sources`, `sources.references.<i>.doi`). */
  errors: Record<string, string>;
  /** Told whether the sources are ready to submit; a pending or failed check is not. */
  onValidity(ready: boolean): void;
}

const MAX_ROWS = 10;
const IDLE: DoiCheck = { status: 'idle' };
const HINT =
  'Leave blank if this comes from your own field work or expert knowledge; otherwise give the DOI.';

/**
 * The `sources` of the claim: the DOIs the rows hold, trimmed, blank rows
 * dropped — and no DOI at all means the contributor's own field work, which
 * the API records as their personal-observation reference.
 * @rfc RFC-70 R1
 * @rfc RFC-80 R5
 */
export function sourcesToBody(value: SourcesValue): CreateRecordBody['sources'] {
  const dois = value.dois.map((doi) => doi.trim()).filter((doi) => doi !== '');
  return dois.length === 0
    ? { personalObservation: true }
    : { references: dois.map((doi) => ({ doi })) };
}

/**
 * Where a claim comes from (RFC-70 R1): the hint that a blank field means the
 * contributor's own work — it describes the rows as a group, so it is written
 * once however many rows there are — and one `DoiField` by default, up to ten,
 * numbered from the second on so the inputs can be told apart. Each is
 * checked against `GET /api/references/resolve` when it loses focus. The
 * checks are held by their trimmed DOI, not by the row, so one value is
 * resolved once however often the row is left again — unless the check itself
 * failed, which is no answer and is asked again — and adding or removing a
 * row keeps what the other rows already resolved. Every row blank is a
 * personal observation, which the line above the submit button says. The form
 * hears through `onValidity` on every change of readiness — unconditionally,
 * so a form that resets its own state while this field stays mounted is told
 * again — that it may submit: only once every non-empty row has resolved. A
 * check still in flight, or one that failed, blocks it, as the API would
 * refuse the record anyway.
 * @rfc RFC-70 R1
 * @rfc RFC-80 R4
 */
export function SourcesField({ value, onChange, errors, onValidity }: SourcesFieldProps) {
  const baseId = useId();
  const [checks, setChecks] = useState<ReadonlyMap<string, DoiCheck>>(() => new Map());
  // One request per distinct value, even for two rows blurred in the same tick.
  const requested = useRef<Set<string>>(new Set());
  const hintId = `${baseId}-hint`;

  const rows = value.dois;
  const dois = rows.map((doi) => doi.trim());
  const checkOf = (index: number): DoiCheck => {
    const doi = dois[index] ?? '';
    return (doi === '' ? undefined : checks.get(doi)) ?? IDLE;
  };
  const ready = dois.every((doi) => doi === '' || checks.get(doi)?.status === 'ok');

  useEffect(() => onValidity(ready), [ready, onValidity]);

  async function check(doi: string) {
    if (doi === '' || requested.current.has(doi)) return;
    requested.current.add(doi);
    setChecks((prev) => new Map(prev).set(doi, { status: 'checking' }));
    let answer: ResolveDoiResult;
    // Only the request is guarded: a mistake in reading the answer is a bug to
    // see, not a DOI to blame.
    try {
      answer = await resolveDoi(doi);
    } catch (error) {
      const failure: DoiCheck =
        error instanceof ApiError && error.code === 'VALIDATION_FAILED'
          ? { status: 'malformed' }
          : { status: 'failed' };
      // Only an answer is remembered. A transport failure is not one: the row
      // says "try again", so leaving the row again asks again — the registry
      // may be back. The value stays in `requested` until the failure comes
      // back, so the retry cannot start while the request is still in flight.
      if (failure.status === 'failed') requested.current.delete(doi);
      setChecks((prev) => new Map(prev).set(doi, failure));
      return;
    }
    setChecks((prev) => new Map(prev).set(doi, resolvedCheck(answer, doi)));
  }

  // The API names a source by its position among the references it was sent
  // (RFC-70 R3), which counts the filled rows only; a blank row shifts every
  // row after it. A message about the sources as a whole lands on the first row.
  function rowError(index: number): string | undefined {
    const doi = dois[index] ?? '';
    const fallback = index === 0 ? errors.sources : undefined;
    if (doi === '') return fallback;
    const path = `sources.references.${dois.slice(0, index).filter((d) => d !== '').length}`;
    return (
      Object.entries(errors).find(([key]) => key === path || key.startsWith(`${path}.`))?.[1] ??
      fallback
    );
  }

  return (
    // The hint describes the rows as a group: it is about having no DOI at
    // all, which is a property of the field, not of any one row — hence the
    // fieldset it describes, rather than a hint repeated on every row.
    <fieldset className="flex flex-col gap-4" aria-describedby={hintId}>
      <legend className="sr-only">Sources</legend>
      <p id={hintId} className="flex items-start gap-1.5 text-meta text-mist-500">
        <span>{HINT}</span>
        <HelpTip learnMore={helpHref('references', 'doi')}>{HINT}</HelpTip>
      </p>
      <div className="flex flex-col gap-4">
        {rows.map((doi, index) => {
          const rowId = `${baseId}-${index}`;
          return (
            <DoiField
              key={rowId}
              id={rowId}
              label={index === 0 ? 'DOI' : `DOI ${index + 1}`}
              value={doi}
              onChange={(next) => onChange({ dois: rows.map((d, i) => (i === index ? next : d)) })}
              check={checkOf(index)}
              onBlur={() => void check(dois[index] ?? '')}
              onRemove={
                rows.length > 1
                  ? () => onChange({ dois: rows.filter((_, i) => i !== index) })
                  : undefined
              }
              error={rowError(index)}
            />
          );
        })}
      </div>
      {rows.length < MAX_ROWS ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => onChange({ dois: [...rows, ''] })}>
            Add another reference
          </Button>
        </div>
      ) : null}
      {dois.every((doi) => doi === '') ? (
        <p className="text-meta text-mist-500">
          This will be recorded as your personal observation
        </p>
      ) : null}
    </fieldset>
  );
}
