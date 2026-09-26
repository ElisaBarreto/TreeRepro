import { useState } from 'react';
import type { ValidateBody } from '../../api/curation.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { Alert, Button, Dialog } from '../ui/index.ts';
import { contributionErrorMessage, SOURCES_NOT_READY } from './errors.ts';
import { EMPTY_SOURCES, SourcesField, type SourcesValue, sourcesToBody } from './SourcesField.tsx';

/** @rfc RFC-70 R4 */
export interface ValidateDialogProps {
  /** What is validated, as the title names it: a level ("dioecious") or a record ID. */
  subject: string;
  /** The species whose summaries and lists the validation leaves stale. */
  speciesId: string;
  /** The write: a level's records (`validateLevel`) or one record (`annotateRecord` with `confirm`). */
  write(body: ValidateBody): Promise<unknown>;
  onClose(): void;
}

/**
 * Validate (spec §2, R-6): one question — "Do you confirm that this record is
 * correct?" — and an optional supporting reference in a single `SourcesField`
 * row (a DOI, or an ISBN with its citation; left blank, none is sent), then
 * the write the caller names. It closes once every stale query is
 * invalidated. Who may validate what (never one's own record, once per user)
 * is the API's answer, shown in the alert, in the API's own words when it
 * names a field this dialog does not lay out (`referenceSource.*`).
 * @rfc RFC-13 R6, R10
 * @rfc RFC-70 R4
 */
export function ValidateDialog({ subject, speciesId, write, onClose }: ValidateDialogProps) {
  const [sources, setSources] = useState<SourcesValue>(EMPTY_SOURCES);
  const [ready, setReady] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const save = useRecordWrite<ValidateBody, unknown>({
    write,
    speciesId,
    onInvalidated: () => onClose(),
  });

  function confirm() {
    if (!ready) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    const body = sourcesToBody(sources);
    save.mutate('references' in body ? { referenceSource: body.references[0] } : {});
  }

  let alert: string | null = null;
  if (blocked) alert = SOURCES_NOT_READY;
  else if (save.isError) {
    alert = Object.values(fieldErrors(save.error))[0] ?? contributionErrorMessage(save.error);
  }

  return (
    <Dialog open title={`Validate ${subject}`} onClose={onClose} closeDisabled={save.isPending}>
      <div className="flex flex-col gap-4">
        <p className="text-body text-canopy-900">Do you confirm that this record is correct?</p>
        <p className="text-meta text-mist-500">A supporting reference is optional.</p>
        <SourcesField
          value={sources}
          onChange={setSources}
          errors={{}}
          onValidity={setReady}
          single
        />
        {alert ? <Alert tone="error">{alert}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button pending={save.isPending} onClick={confirm}>
            Validate
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
