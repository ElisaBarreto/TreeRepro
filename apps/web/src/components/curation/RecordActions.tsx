import type { RecordDetail, RecordIntent } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { annotateRecord } from '../../api/curation.ts';
import { datasetKeys } from '../../api/dataset.ts';
import { helpHref } from '../../content/help/href.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { DrawerSection } from '../dataset/DrawerSection.tsx';
import { Button, ConfirmDialog, HelpTip, Icon } from '../ui/index.ts';
import { AddEntriesDialog, type RespondTo } from './AddEntriesDialog.tsx';
import { contributionErrorMessage } from './errors.ts';
import { ValidateDialog } from './ValidateDialog.tsx';

/**
 * The sentence a record action shows for an API refusal: what only the
 * curation actions can hit, falling back to the contribution map of RFC-70
 * and RFC-80.
 * @rfc RFC-13 R6
 */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RECORD_NOT_WITHDRAWABLE':
        return 'You may not withdraw this record.';
      case 'RECORD_NOT_FOUND':
        return 'This record no longer exists.';
    }
  }
  return contributionErrorMessage(error);
}

const VALIDATE_HELP =
  'Records that you agree with this value as it stands. Nothing is changed; your validation is attached to the record.';
const RESPOND_HELP =
  'Contest: the value is wrong, and you add the one you believe is right. Complement: the value is right, and you add another one. Either way you add a record of your own.';
const WITHDRAW_MESSAGE =
  'The record leaves the dataset for every viewer. It stays in the database for audit only.';

type Open = 'validate' | 'withdraw' | RecordIntent;

// 👎 presets Contest: a categorical record leaves its level unchecked, a
// quantitative one is the value responded to. ＋ presets no intent (RFC-70
// R9), only the target.
function respondTo(record: RecordDetail, intent: RecordIntent): RespondTo {
  if (intent === 'complement') return { recordId: record.id, levelId: record.level?.id };
  return record.trait.valueType === 'categorical'
    ? { intent: 'contest', levelId: record.level?.id }
    : { intent: 'contest', recordId: record.id };
}

/**
 * What a viewer can do with one record (spec §2), the decisions the page
 * legend names:
 * - **Validate** opens {@link ValidateDialog} and posts a `confirm`. It is
 *   not offered on the viewer's own record, which the API refuses to confirm
 *   (RFC-65 R3), and is disabled once they validated it (spec R-6).
 * - **Contest** and **Complement** open {@link AddEntriesDialog} already
 *   answered with this record, since a different value is a record of its
 *   own and needs `records.create` (RFC-70 R1, R9).
 * - **Withdraw** only asks for confirmation, with no note (spec R-12). It is
 *   shown to the author, to `records.withdraw` holders on a manual record and
 *   to `records.withdraw_imported` holders on an imported one. A withdrawal
 *   answers `null`: the record is dropped from the cache and `onGone` closes
 *   the drawer, since the record has left the dataset (R-13).
 *
 * Everything needs `records.annotate`; a viewer with nothing to do sees no
 * section at all. The API remains the authority on every one of these
 * (RFC-13 R3).
 * @rfc RFC-13 R3, R6, R11
 * @rfc RFC-65 R3, R4
 * @rfc RFC-70 R1, R4, R9
 */
export function RecordActions({
  record,
  onOpenRecord,
  onGone,
}: {
  record: RecordDetail;
  /** Opens another record in the drawer this section sits in; the new record after an entry. */
  onOpenRecord?: (id: string) => void;
  /** Called once a withdrawal has taken the record out of the dataset: the drawer closes. */
  onGone?: () => void;
}) {
  const me = useMe();
  const validatedId = useId();
  const [open, setOpen] = useState<Open | null>(null);
  const withdraw = useRecordWrite<void, RecordDetail | null>({
    write: () => annotateRecord(record.id, { kind: 'withdraw' }),
    speciesId: record.speciesId,
    onWritten: (detail, queryClient) => {
      // `null` means the record was withdrawn (RFC-33 R2). Dropped from the
      // cache before the invalidation can refetch it into a 404 the drawer
      // would flash as an error Alert before `onGone` closes it.
      if (detail === null) queryClient.removeQueries({ queryKey: datasetKeys.record(record.id) });
    },
    onInvalidated: (detail) => {
      if (detail === null) {
        setOpen(null);
        onGone?.();
      }
    },
  });

  if (!hasPermission(me, 'records.annotate')) return null;
  const isAuthor = record.createdBy?.id === me.user.id;
  // A validation is never undone (spec R-6).
  const validated = record.annotations.some(
    (annotation) => annotation.kind === 'confirm' && annotation.actor.id === me.user.id,
  );
  const canRespond = hasPermission(me, 'records.create');
  const canWithdraw =
    isAuthor ||
    hasPermission(
      me,
      record.origin === 'manual' ? 'records.withdraw' : 'records.withdraw_imported',
    );

  return (
    <DrawerSection title="Actions">
      <div className="flex flex-wrap items-center gap-2">
        {isAuthor ? null : (
          <>
            <Button
              size="sm"
              disabled={validated}
              aria-describedby={validated ? validatedId : undefined}
              onClick={() => setOpen('validate')}
            >
              <Icon name="thumbsUp" size={16} /> Validate
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
        )}
        {canRespond ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen('contest')}>
              <Icon name="thumbsDown" size={16} /> Contest
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpen('complement')}>
              <Icon name="plus" size={16} /> Complement
            </Button>
            <HelpTip
              label="What do Contest and Complement mean?"
              learnMore={helpHref('workflow', 'different')}
            >
              {RESPOND_HELP}
            </HelpTip>
          </>
        ) : null}
        {canWithdraw ? (
          <Button variant="danger" size="sm" onClick={() => setOpen('withdraw')}>
            Withdraw
          </Button>
        ) : null}
      </div>
      {open === 'validate' ? (
        <ValidateDialog
          subject={record.recordCode}
          speciesId={record.speciesId}
          write={(body) => annotateRecord(record.id, { kind: 'confirm', ...body })}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'contest' || open === 'complement' ? (
        <AddEntriesDialog
          speciesId={record.speciesId}
          initialTrait={record.trait}
          respondTo={respondTo(record, open)}
          onClose={() => setOpen(null)}
          onCreated={(result) => {
            setOpen(null);
            const [first] = result.created;
            if (first) onOpenRecord?.(first.id);
          }}
          onOpenRecord={(id) => {
            setOpen(null);
            onOpenRecord?.(id);
          }}
        />
      ) : null}
      {open === 'withdraw' ? (
        <ConfirmDialog
          title="Withdraw this record?"
          message={WITHDRAW_MESSAGE}
          confirmLabel="Withdraw"
          danger
          pending={withdraw.isPending}
          error={withdraw.error ? actionErrorMessage(withdraw.error) : null}
          onConfirm={() => withdraw.mutate()}
          onClose={() => {
            withdraw.reset();
            setOpen(null);
          }}
        />
      ) : null}
    </DrawerSection>
  );
}
