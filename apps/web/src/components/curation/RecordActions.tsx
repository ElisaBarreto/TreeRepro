import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AnnotateRecordBody, RecordDetail } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import {
  annotateRecord,
  curationKeys,
  invalidateAfterRecordWrite,
  setAccepted,
} from '../../api/curation.ts';
import { datasetKeys } from '../../api/dataset.ts';
import { fieldErrors, pageErrorMessage } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { DrawerSection } from '../dataset/DrawerSection.tsx';
import { Alert, Badge, Button, Field, Textarea } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RECORD_WITHDRAWN':
        return 'This record is withdrawn.';
      case 'RECORD_NOT_WITHDRAWABLE':
        return 'Only manual records can be withdrawn.';
      case 'RECORD_IS_ACCEPTED':
        return 'This record is the accepted value; change the accepted value first.';
      case 'RECORD_NOT_HARMONISED':
        return 'Only a harmonised record can be the accepted value.';
      case 'RECORD_NOT_FOUND':
        return 'This record no longer exists.';
      case 'VALIDATION_FAILED':
        return 'Check the note.';
    }
  }
  return pageErrorMessage(error);
}

type NoteMode = 'dispute' | 'withdraw';
const NOTE_LABELS: Record<NoteMode, { title: string; submit: string }> = {
  dispute: { title: 'Why do you dispute this record?', submit: 'Send dispute' },
  withdraw: { title: 'Why is this record withdrawn?', submit: 'Confirm withdrawal' },
};

/**
 * The curation buttons of one record (RFC-65 R3–R6), shown by permission —
 * the API decides. Confirm and Neutral post at once; Dispute and Withdraw
 * open a note form (the note is required); Set as accepted marks this record
 * as the species × trait value. Withdraw appears only on a manual record of
 * the signed-in user, or for a `records.withdraw` holder. A withdrawn record
 * has no actions; the accepted record shows a badge instead of the button.
 * Renders its own "Actions" section, and none at all for a viewer with
 * nothing to show, so the drawer never carries an empty heading. After a
 * write the drawer's record query is replaced with the answer and the lists
 * and summaries are invalidated.
 * @rfc RFC-13 R3, R6
 * @rfc RFC-65 R3, R4, R6
 */
export function RecordActions({ record }: { record: RecordDetail }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [mode, setMode] = useState<NoteMode | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const annotate = useMutation({
    mutationFn: (body: AnnotateRecordBody) => annotateRecord(record.id, body),
    onSuccess: async (detail) => {
      queryClient.setQueryData(datasetKeys.record(record.id), detail);
      // Only the form state here — not `openMode(null)`: resetting a mutation
      // from inside its own onSuccess flips isPending before the invalidation
      // below settles, and would detach an in-flight accept.
      setMode(null);
      setNote('');
      setNoteError(null);
      await invalidateAfterRecordWrite(queryClient, record.speciesId);
    },
  });
  const accept = useMutation({
    mutationFn: () =>
      setAccepted(record.speciesId, record.trait.id, { decision: 'accepted', recordId: record.id }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: curationKeys.accepted(record.speciesId, record.trait.id),
        }),
        invalidateAfterRecordWrite(queryClient, record.speciesId),
      ]);
    },
  });

  // Switching between Dispute and Withdraw, or cancelling either, must not
  // leave the other's typed note, validation error or failed write behind.
  function openMode(next: NoteMode | null) {
    setMode(next);
    setNote('');
    setNoteError(null);
    annotate.reset();
    accept.reset();
  }

  const withdrawn = record.review === 'withdrawn';
  const canAnnotate = hasPermission(me, 'records.annotate') && !withdrawn;
  const isAuthor = record.createdBy?.id === me.user.id;
  const canWithdraw =
    canAnnotate &&
    record.origin === 'manual' &&
    (isAuthor || hasPermission(me, 'records.withdraw'));
  const newest = record.acceptedHistory[0];
  const isAccepted = newest?.decision === 'accepted' && newest.recordId === record.id;
  const canAccept =
    hasPermission(me, 'accepted.manage') &&
    !withdrawn &&
    record.harmonisation === 'harmonised' &&
    !isAccepted;
  // A validation detail on the note lands under the field; anything else is
  // the alert below the buttons.
  const noteDetail = fieldErrors(annotate.error).note;
  const error = noteDetail ? accept.error : (annotate.error ?? accept.error);

  if (withdrawn) {
    return (
      <DrawerSection title="Actions">
        <p className="text-body text-mist-500">This record is withdrawn.</p>
      </DrawerSection>
    );
  }
  if (!canAnnotate && !canAccept && !isAccepted) return null;

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    const text = note.trim();
    if (!text) {
      setNoteError('A note is required.');
      return;
    }
    setNoteError(null);
    annotate.mutate({ kind: mode, note: text });
  }

  return (
    <DrawerSection title="Actions">
      <div className="flex flex-wrap gap-2">
        {canAnnotate ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              pending={annotate.isPending}
              onClick={() => annotate.mutate({ kind: 'confirm' })}
            >
              Confirm
            </Button>
            <Button
              variant="secondary"
              size="sm"
              pending={annotate.isPending}
              onClick={() => annotate.mutate({ kind: 'neutral' })}
            >
              Neutral
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openMode(mode === 'dispute' ? null : 'dispute')}
              aria-pressed={mode === 'dispute'}
            >
              Dispute
            </Button>
          </>
        ) : null}
        {canWithdraw ? (
          <Button
            variant="danger"
            size="sm"
            onClick={() => openMode(mode === 'withdraw' ? null : 'withdraw')}
            aria-pressed={mode === 'withdraw'}
          >
            Withdraw
          </Button>
        ) : null}
        {isAccepted ? <Badge tone="green">accepted value</Badge> : null}
        {canAccept ? (
          <Button size="sm" pending={accept.isPending} onClick={() => accept.mutate()}>
            Set as accepted
          </Button>
        ) : null}
      </div>
      {mode ? (
        <form
          onSubmit={submitNote}
          className="flex flex-col gap-3 rounded-[10px] border border-canopy-700/15 p-4"
          noValidate
        >
          <Field
            id={noteId}
            label={NOTE_LABELS[mode].title}
            error={noteError ?? noteDetail ?? undefined}
          >
            <Textarea
              id={noteId}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              invalid={Boolean(noteError ?? noteDetail)}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant={mode === 'withdraw' ? 'danger' : 'primary'}
              pending={annotate.isPending}
            >
              {NOTE_LABELS[mode].submit}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {error ? <Alert tone="error">{actionErrorMessage(error)}</Alert> : null}
    </DrawerSection>
  );
}
