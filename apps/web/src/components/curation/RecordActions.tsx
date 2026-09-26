import type { AnnotateRecordBody, RecordDetail, ResolveDoiResult } from '@treerepro/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { annotateRecord, resolveDoi } from '../../api/curation.ts';
import { datasetKeys } from '../../api/dataset.ts';
import { helpHref } from '../../content/help/href.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { DrawerSection } from '../dataset/DrawerSection.tsx';
import { Alert, Button, ConfirmDialog, HelpTip } from '../ui/index.ts';
import { ContestDialog } from './ContestDialog.tsx';
import { type DoiCheck, DoiField, doiBlocks, resolvedCheck } from './DoiField.tsx';
import { contributionErrorMessage } from './errors.ts';

/**
 * The sentence a record action shows for an API refusal: what only the
 * curation actions can hit, falling back to the contribution map of RFC-70
 * and RFC-80 (a validation with a supporting DOI reaches the same registry
 * the contest form does). A `VALIDATION_FAILED` has no sentence of its own
 * here: its detail lands under the DOI it is about.
 * @rfc RFC-13 R6
 */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RECORD_NOT_FOUND':
        return 'This record no longer exists.';
    }
  }
  return contributionErrorMessage(error);
}

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
 * bare validation, and so needs the `records.create` that creating one
 * takes. Validate is out of reach once the viewer has already validated the
 * record — a validation is never undone (spec R-6) — and is not offered on
 * the viewer's own record, which the API refuses to confirm (RFC-65 R3).
 *
 * Withdraw (spec R-12: author, `records.withdraw` for manual,
 * `records.withdraw_imported` for imported records) asks for confirmation
 * only. A withdrawn record never reaches the drawer (RFC-63 R13); a viewer
 * with nothing to do sees no section at all, so the drawer never carries an
 * empty heading. After a write the drawer's record query is replaced with
 * the answer and the lists and summaries are invalidated (`useRecordWrite`);
 * a withdrawal instead calls `onGone`, which closes the drawer, since there
 * is no record left to show.
 * @rfc RFC-13 R3, R6, R11
 * @rfc RFC-65 R3, R4
 * @rfc RFC-70 R1, R4
 * @rfc RFC-80 R4
 */
export function RecordActions({
  record,
  onOpenRecord,
  onGone,
}: {
  record: RecordDetail;
  /** Opens another record in the drawer this section sits in; the new record after a contest. */
  onOpenRecord?: (id: string) => void;
  /** Called once a withdrawal has taken the record out of the dataset: the drawer closes. */
  onGone?: () => void;
}) {
  const me = useMe();
  const doiId = useId();
  const validatedId = useId();
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
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
      // no detail to seed the cache with. Dropped from the cache here, before
      // the invalidation below can refetch it into a 404 the drawer would
      // flash as an error Alert for the instant before `onInvalidated`
      // closes it: removed, the query reads as still loading instead.
      if (detail) {
        queryClient.setQueryData(datasetKeys.record(record.id), detail);
      } else {
        queryClient.removeQueries({ queryKey: datasetKeys.record(record.id) });
      }
    },
    onInvalidated: (detail) => {
      if (detail === null) {
        setConfirmingWithdraw(false);
        onGone?.();
      }
    },
  });

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
  // A different value is a record of its own, so the button that opens the
  // form needs what `POST /api/records` needs (RFC-70 R1); validating only
  // annotates. Offering it to a viewer the API would answer 403 is a button
  // that can only fail.
  const canContest = canAnnotate && hasPermission(me, 'records.create');
  const isAuthor = record.createdBy?.id === me.user.id;
  // The API refuses a confirm on one's own record (RFC-65 R3, 403): the
  // button is not offered.
  const canValidate = canAnnotate && !isAuthor;
  const canWithdraw =
    canAnnotate &&
    (isAuthor ||
      (record.origin === 'manual'
        ? hasPermission(me, 'records.withdraw')
        : hasPermission(me, 'records.withdraw_imported')));
  // A validation is never undone (spec R-6).
  const validated = record.annotations.some(
    (a) => a.actor.id === me.user.id && a.kind === 'confirm',
  );

  // A validation detail on the supporting reference lands under its field;
  // anything else is the alert below the buttons.
  const details = fieldErrors(annotate.error);
  const doiDetail =
    details['referenceSource.doi'] ?? details['referenceSource.id'] ?? details.referenceSource;
  const bound = doiDetail !== undefined;
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

  function validate() {
    setAttempts((n) => n + 1);
    annotate.mutate({
      kind: 'confirm',
      ...(supporting ? { referenceSource: { doi: supporting } } : {}),
    });
  }

  // The API's refusal was about the DOI that was sent; the moment the field
  // holds something else it describes nothing, so it goes. Guarded on the
  // refusal being about the DOI at all: while a validation is in flight
  // there is no error to clear, so this can never detach one.
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
        {canValidate ? (
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
        {canWithdraw ? (
          <Button variant="danger" size="sm" onClick={() => setConfirmingWithdraw(true)}>
            Withdraw
          </Button>
        ) : null}
      </div>
      {canValidate && !validated ? (
        // One element, whatever the field has to say: swapping the wrapper's
        // type would remount the input — and a block clears on the very
        // keystroke that starts correcting it, so the contributor would lose
        // the field from under the cursor.
        <details ref={detailsRef}>
          <summary className="cursor-pointer text-meta text-canopy-900">{DOI_SUMMARY}</summary>
          <div className="pt-3">{doiField}</div>
        </details>
      ) : null}
      {/* A failed withdrawal already shows its error inside the confirm
          dialog below; showing it here too would say the same sentence
          twice. */}
      {error && !confirmingWithdraw ? (
        <Alert tone="error">{actionErrorMessage(error)}</Alert>
      ) : null}
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
      {confirmingWithdraw ? (
        <ConfirmDialog
          title="Withdraw this record?"
          message="The record leaves the dataset for everyone. This cannot be undone."
          confirmLabel="Withdraw"
          danger
          pending={annotate.isPending}
          error={annotate.error ? actionErrorMessage(annotate.error) : null}
          onConfirm={() => annotate.mutate({ kind: 'withdraw' })}
          onClose={() => {
            annotate.reset();
            setConfirmingWithdraw(false);
          }}
        />
      ) : null}
    </DrawerSection>
  );
}
