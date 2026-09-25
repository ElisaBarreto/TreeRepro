import type { AnnotateRecordBody, RecordDetail, ResolveDoiResult } from '@treerepro/contracts';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { annotateRecord, resolveDoi } from '../../api/curation.ts';
import { datasetKeys } from '../../api/dataset.ts';
import { helpHref } from '../../content/help/href.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { DrawerSection } from '../dataset/DrawerSection.tsx';
import { Alert, Button, Field, HelpTip, Textarea } from '../ui/index.ts';
import { ContestDialog } from './ContestDialog.tsx';
import { type DoiCheck, DoiField, doiBlocks, resolvedCheck } from './DoiField.tsx';
import { contributionErrorMessage } from './errors.ts';

/**
 * The sentence a record action shows for an API refusal: what only the
 * curation actions can hit, falling back to the contribution map of RFC-70
 * and RFC-80 (a validation with a supporting DOI reaches the same registry
 * the contest form does). A `VALIDATION_FAILED` has no sentence of its own
 * here: its detail lands under the note or the DOI it is about.
 * @rfc RFC-13 R6
 */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RECORD_WITHDRAWN':
        return 'This record is withdrawn.';
      case 'RECORD_NOT_WITHDRAWABLE':
        return 'Only manual records can be withdrawn.';
      case 'RECORD_NOT_FOUND':
        return 'This record no longer exists.';
    }
  }
  return contributionErrorMessage(error);
}

type NoteMode = 'dispute' | 'withdraw';
const NOTE_LABELS: Record<NoteMode, { title: string; submit: string }> = {
  dispute: { title: 'Why do you dispute this record?', submit: 'Send dispute' },
  withdraw: { title: 'Why is this record withdrawn?', submit: 'Confirm withdrawal' },
};

const VALIDATE_HELP =
  'Records that you agree with this value as it stands. Nothing is changed; your confirmation is attached to the record.';
const CONTEST_HELP =
  'Opens a form for a different or additional value. You will say whether it contests this record (it is wrong) or complements it (both are true).';

const DOI_SUMMARY = 'Add a supporting DOI (optional)';

/**
 * The two decisions a record asks of a contributor (RFC-70 R4, spec §7.1):
 * **✓ Validate** — the value is right as it stands, posted as a `confirm`
 * that may carry a supporting DOI, on `records.annotate` — and **+ Add
 * different record**, which opens {@link ContestDialog} rather than writing
 * anything here, because a different value is a record of its own, never a
 * bare dispute, and so needs the `records.create` that creating one takes.
 * Validate is
 * out of reach once the viewer's own latest stance on the record is already
 * `confirm`; a withdraw of theirs is not a stance, and neither is anyone
 * else's.
 *
 * The reviewer actions Neutral and Dispute (with the note the API requires)
 * need `records.review` on top of `records.annotate` (RFC-70 R4); Withdraw
 * stays with the author and the `records.withdraw` holder (RFC-65 R4). A
 * withdrawn record never reaches the drawer (RFC-63 R13); a viewer with nothing to do sees no
 * section at all, so the drawer never carries an empty heading. After a
 * write the drawer's record query is replaced with the answer and the lists
 * and summaries are invalidated (`useRecordWrite`).
 * @rfc RFC-13 R3, R6, R11
 * @rfc RFC-65 R3, R4
 * @rfc RFC-70 R1, R4
 * @rfc RFC-80 R4
 */
export function RecordActions({
  record,
  onOpenRecord,
}: {
  record: RecordDetail;
  /** Opens another record in the drawer this section sits in; the new record after a contest. */
  onOpenRecord?: (id: string) => void;
}) {
  const me = useMe();
  const noteId = useId();
  const doiId = useId();
  const validatedId = useId();
  const [mode, setMode] = useState<NoteMode | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [contesting, setContesting] = useState(false);
  const [doi, setDoi] = useState('');
  // The answer is held with the DOI it is about, never on its own: editing
  // the field must not leave a "Resolved: …" line describing a value that is
  // no longer there — and that Validate would then send.
  const [checked, setChecked] = useState<{ doi: string; check: DoiCheck } | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Counts the validations sent; see `doiComplaint` below.
  const [attempts, setAttempts] = useState(0);

  const annotate = useRecordWrite<AnnotateRecordBody, RecordDetail | null>({
    write: (body) => annotateRecord(record.id, body),
    speciesId: record.speciesId,
    onWritten: (detail, queryClient) => {
      // `null` means the annotation withdrew the record (RFC-33 R2): there is
      // no detail to seed the cache with, and the invalidation below leaves
      // the drawer's record query to 404 — acceptable until Task 5 gives the
      // drawer an onGone to close itself with.
      if (detail) queryClient.setQueryData(datasetKeys.record(record.id), detail);
      // Only the form state here — not `openMode(null)`: resetting a mutation
      // from inside its own onSuccess flips isPending before the invalidation
      // settles, and would detach the in-flight invalidation.
      setMode(null);
      setNote('');
      setNoteError(null);
    },
  });
  // Switching between Dispute and Withdraw, or cancelling either, must not
  // leave the other's typed note, validation error or failed write behind.
  function openMode(next: NoteMode | null) {
    setMode(next);
    setNote('');
    setNoteError(null);
    annotate.reset();
  }

  // One request per value: an answer is kept, but a failed check is no
  // answer and leaving the field again asks the registry once more.
  async function checkDoi(current: DoiCheck) {
    const value = doi.trim();
    if (value === '' || (current.status !== 'idle' && current.status !== 'failed')) return;
    setChecked({ doi: value, check: { status: 'checking' } });
    let result: ResolveDoiResult;
    try {
      result = await resolveDoi(value);
    } catch (error) {
      const malformed = error instanceof ApiError && error.code === 'VALIDATION_FAILED';
      setChecked({ doi: value, check: { status: malformed ? 'malformed' : 'failed' } });
      return;
    }
    setChecked({ doi: value, check: resolvedCheck(result, value) });
  }

  const canAnnotate = hasPermission(me, 'records.annotate');
  const canReview = canAnnotate && hasPermission(me, 'records.review');
  // A different value is a record of its own, so the button that opens the
  // form needs what `POST /api/records` needs (RFC-70 R1); validating only
  // annotates. Offering it to a viewer the API would answer 403 is a button
  // that can only fail.
  const canContest = canAnnotate && hasPermission(me, 'records.create');
  const isAuthor = record.createdBy?.id === me.user.id;
  const canWithdraw =
    canAnnotate &&
    record.origin === 'manual' &&
    (isAuthor || hasPermission(me, 'records.withdraw'));
  // A withdraw is not a stance: it says the record is gone, not what the
  // viewer thinks of its value. The API orders annotations newest first.
  const stance = record.annotations.find(
    (a) => a.actor.id === me.user.id && a.kind !== 'withdraw',
  )?.kind;
  const validated = stance === 'confirm';

  // A validation detail on the note or on the supporting reference lands
  // under its field; anything else is the alert below the buttons.
  const details = fieldErrors(annotate.error);
  const noteDetail = details.note;
  const doiDetail = details['reference.doi'] ?? details['reference.id'] ?? details.reference;
  const bound = noteDetail !== undefined || doiDetail !== undefined;
  const error = bound ? null : annotate.error;
  const supporting = doi.trim();
  const doiCheck: DoiCheck =
    checked && checked.doi === supporting ? checked.check : { status: 'idle' };
  // A blocking line (RFC-80 R4): the API would refuse the annotation, so
  // Validate does too — and waits out a check still in flight rather than
  // sending a DOI nobody has answered for.
  const doiRefused = doiBlocks(doiCheck) || doiCheck.status === 'checking';
  // What there is to say about the DOI, and on which attempt — a string, so
  // the effect below compares meanings rather than object identities. The
  // attempt belongs in it because a refusal repeated word for word is still a
  // new thing to say, and nothing else about it differs: the message and the
  // check are both unchanged. Clearing the mutation's error on the way to the
  // second attempt happens to blank this in between, which would reopen the
  // disclosure on its own — but that is a render TanStack may or may not
  // commit separately, and whether a contributor is told their validation
  // failed must not rest on it.
  const doiComplaint =
    doiDetail !== undefined || doiBlocks(doiCheck)
      ? `${attempts}:${doiDetail ?? doiCheck.status}`
      : null;

  // Anything said about the DOI is said in the open: a disabled Validate
  // whose reason sits inside a collapsed disclosure is a button that fails
  // silently. Set on the element, never through an `open` prop — React
  // reconciles an unchanged prop against a DOM the browser has since changed,
  // so a controlled `<details>` would stay shut once collapsed. The element
  // itself never changes type, so the field is never remounted under a
  // cursor that is correcting it.
  useEffect(() => {
    if (doiComplaint !== null && detailsRef.current) detailsRef.current.open = true;
  }, [doiComplaint]);

  if (!canAnnotate) return null;

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

  function validate() {
    setAttempts((n) => n + 1);
    annotate.mutate({ kind: 'confirm', ...(supporting ? { reference: { doi: supporting } } : {}) });
  }

  // The API's refusal was about the DOI that was sent; the moment the field
  // holds something else it describes nothing, so it goes. Guarded on the
  // refusal being about the DOI at all: a note's validation detail lives in
  // the same mutation, and typing a DOI must not wipe it from the form beside
  // it. While a validation is in flight there is no error to clear, so this
  // can never detach one.
  function changeDoi(next: string) {
    setDoi(next);
    if (doiDetail !== undefined) annotate.reset();
  }

  const doiField = (
    <DoiField
      id={doiId}
      value={doi}
      onChange={changeDoi}
      check={doiCheck}
      onBlur={() => void checkDoi(doiCheck)}
      error={doiDetail}
    />
  );

  return (
    <DrawerSection title="Actions">
      <div className="flex flex-wrap items-center gap-2">
        {canAnnotate ? (
          <>
            <Button
              variant="primary"
              size="sm"
              pending={annotate.isPending}
              disabled={validated || doiRefused}
              aria-describedby={validated ? validatedId : undefined}
              title={validated ? undefined : 'I agree with this value as it stands'}
              onClick={validate}
            >
              ✓ Validate
            </Button>
            <HelpTip label="What does Validate mean?" learnMore={helpHref('workflow', 'validate')}>
              {VALIDATE_HELP}
            </HelpTip>
            {validated ? (
              // Not the button's `title`: a disabled control gets no pointer
              // events, so several browsers never open that tooltip.
              <span id={validatedId} className="text-meta text-mist-500">
                You validated this record
              </span>
            ) : null}
          </>
        ) : null}
        {canContest ? (
          <>
            <Button
              // Spec 7.1: a red outline, not the solid red of Withdraw — this
              // is the contributor's main action, and the one destructive
              // control on the screen keeps the filled `danger` to itself.
              variant="secondary"
              size="sm"
              className="border-red-700/40 text-red-700 hover:bg-red-50"
              title="I have a different or additional value"
              onClick={() => setContesting(true)}
            >
              + Add different record
            </Button>
            <HelpTip
              label="What does Add different record mean?"
              learnMore={helpHref('workflow', 'different')}
            >
              {CONTEST_HELP}
            </HelpTip>
          </>
        ) : null}
        {canReview ? (
          <>
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
      </div>
      {canAnnotate && !validated ? (
        // One element, whatever the field has to say: swapping the wrapper's
        // type would remount the input — and a block clears on the very
        // keystroke that starts correcting it, so the contributor would lose
        // the field from under the cursor.
        <details ref={detailsRef}>
          <summary className="cursor-pointer text-meta text-canopy-900">{DOI_SUMMARY}</summary>
          <div className="pt-3">{doiField}</div>
        </details>
      ) : null}
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
      {contesting ? (
        <ContestDialog
          record={record}
          onClose={() => setContesting(false)}
          onCreated={(result) => {
            setContesting(false);
            const [first] = result.created;
            if (first) onOpenRecord?.(first.id);
          }}
          onOpenRecord={(id) => {
            setContesting(false);
            onOpenRecord?.(id);
          }}
        />
      ) : null}
    </DrawerSection>
  );
}
