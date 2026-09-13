import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcceptedHistoryEntry } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import {
  curationKeys,
  fetchAccepted,
  invalidateAfterRecordWrite,
  setAccepted,
} from '../../api/curation.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { isoDate } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { Alert, Badge, Button, Field, Textarea } from '../ui/index.ts';

function HistoryEntry({ entry }: { entry: AcceptedHistoryEntry }) {
  return (
    <li className="flex flex-col gap-0.5 text-cell">
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={entry.decision === 'accepted' ? 'green' : 'neutral'}>{entry.decision}</Badge>
        {entry.valueText ? (
          <span className="font-medium text-canopy-950">{entry.valueText}</span>
        ) : null}
        <span className="text-canopy-900">{entry.actor.name}</span>
        <time dateTime={entry.createdAt} className="text-mist-500">
          {isoDate(entry.createdAt)}
        </time>
      </span>
      {entry.note ? <span className="text-canopy-950">{entry.note}</span> : null}
    </li>
  );
}

/**
 * The accepted value of one species × trait (RFC-65 R6, R11): the current
 * decision with its curator, date and note; Clear with a required note for
 * `accepted.manage`; the decision history on demand.
 * @rfc RFC-13 R3, R6
 * @rfc RFC-65 R6, R11
 */
export function AcceptedSection({ speciesId, traitId }: { speciesId: string; traitId: string }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [clearing, setClearing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  // Cancelling, or reopening after a cancel, must not leave a stale note or
  // validation error from the previous time the form was open.
  function toggleClearing(next: boolean) {
    setClearing(next);
    setNote('');
    setNoteError(null);
  }

  const state = useQuery({
    queryKey: curationKeys.accepted(speciesId, traitId),
    queryFn: () => fetchAccepted(speciesId, traitId),
  });
  const clear = useMutation({
    mutationFn: (text: string) =>
      setAccepted(speciesId, traitId, { decision: 'cleared', note: text }),
    onSuccess: async (next) => {
      queryClient.setQueryData(curationKeys.accepted(speciesId, traitId), next);
      toggleClearing(false);
      await invalidateAfterRecordWrite(queryClient, speciesId);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = note.trim();
    if (!text) {
      setNoteError('A note is required.');
      return;
    }
    setNoteError(null);
    clear.mutate(text);
  }

  const current = state.data?.current;
  return (
    <section
      aria-labelledby={`${noteId}-heading`}
      className="flex flex-col gap-2.5 rounded-[10px] border border-canopy-700/15 bg-mist-50/60 p-4"
    >
      <h3
        id={`${noteId}-heading`}
        className="text-label font-bold uppercase tracking-[0.08em] text-mist-500"
      >
        Accepted value
      </h3>
      {state.isError ? <Alert tone="error">{pageErrorMessage(state.error)}</Alert> : null}
      {state.isPending ? <p className="text-body text-mist-500">Loading…</p> : null}
      {state.isSuccess && !current ? (
        <p className="text-body text-mist-500">No accepted value yet.</p>
      ) : null}
      {current ? (
        <div className="flex flex-col gap-1 text-cell">
          <span className="font-display text-card font-semibold text-canopy-950">
            {current.valueText}
          </span>
          <span className="text-mist-500">
            by {current.actor.name} ·{' '}
            <time dateTime={current.decidedAt}>{isoDate(current.decidedAt)}</time>
          </span>
          {current.note ? <span className="text-canopy-950">{current.note}</span> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {current && hasPermission(me, 'accepted.manage') ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toggleClearing(!clearing)}
            aria-pressed={clearing}
          >
            Clear
          </Button>
        ) : null}
        {state.data && state.data.history.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
          >
            {showHistory ? 'Hide history' : 'Show history'}
          </Button>
        ) : null}
      </div>
      {clearing ? (
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <Field
            id={noteId}
            label="Why is the accepted value cleared?"
            error={noteError ?? undefined}
          >
            <Textarea
              id={noteId}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              invalid={Boolean(noteError)}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" pending={clear.isPending}>
              Confirm clear
            </Button>
            <Button variant="secondary" size="sm" onClick={() => toggleClearing(false)}>
              Cancel
            </Button>
          </div>
          {clear.isError ? <Alert tone="error">{pageErrorMessage(clear.error)}</Alert> : null}
        </form>
      ) : null}
      {showHistory && state.data ? (
        <ul aria-label="Accepted value history" className="flex flex-col gap-2">
          {state.data.history.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
