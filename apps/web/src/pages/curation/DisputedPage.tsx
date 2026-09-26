import type { ContestedQueueItem, WithdrawLevelResult } from '@treerepro/contracts';
import { useState } from 'react';
import {
  annotateRecord,
  curationKeys,
  fetchContested,
  resolveContest,
  withdrawContest,
  withdrawLevel,
} from '../../api/curation.ts';
import { type ContestAction, DisputedTable } from '../../components/curation/DisputedTable.tsx';
import { actionErrorMessage } from '../../components/curation/RecordActions.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { Alert, ConfirmDialog, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';

type Pending = { item: ContestedQueueItem; action: ContestAction };

function question({ action }: Pending): {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
} {
  switch (action.kind) {
    case 'keep':
      return {
        title: 'Keep both values?',
        message: 'The contest closes and every value it names stays in the dataset.',
        confirmLabel: 'Keep both',
        danger: false,
      };
    case 'withdrawContest':
      return {
        title: 'Withdraw the contest?',
        message: 'Every record the contest created leaves the dataset. This cannot be undone.',
        confirmLabel: 'Withdraw',
        danger: true,
      };
    case 'withdrawLevel':
      return {
        title: `Withdraw every "${action.key}" record?`,
        message:
          'Every record of this level that you may withdraw leaves the dataset. This cannot be undone.',
        confirmLabel: 'Withdraw',
        danger: true,
      };
    case 'withdrawTarget':
      return {
        title: 'Withdraw the contested record?',
        message: 'The contested record leaves the dataset. This cannot be undone.',
        confirmLabel: 'Withdraw',
        danger: true,
      };
  }
}

function run({ item, action }: Pending): Promise<unknown> {
  switch (action.kind) {
    case 'keep':
      return resolveContest(item.id);
    case 'withdrawContest':
      return withdrawContest(item.id);
    case 'withdrawLevel':
      return withdrawLevel(item.species.id, item.trait.id, action.levelId);
    case 'withdrawTarget':
      return annotateRecord(action.target.id, { kind: 'withdraw' });
  }
}

/** RFC-65 R14's sentence for a level withdrawal that leaves records behind. */
function remainingNotice(pending: Pending, result: unknown): string | null {
  if (pending.action.kind !== 'withdrawLevel' || !result || typeof result !== 'object') return null;
  const remaining = (result as WithdrawLevelResult).remaining;
  return remaining.length > 0
    ? `${remaining.length} records remain that you cannot withdraw — an admin can withdraw them, or use Keep both`
    : null;
}

/**
 * The contested queue (RFC-65 R10): one row per open contest, newest first.
 * A reviewer keeps both values (R16), withdraws the contest (R16), withdraws
 * one of its named levels (R14), or — for a quantitative contest — withdraws
 * the record it responds to (R4, through the annotations route). Every
 * choice asks for confirmation; a level withdrawal that leaves records
 * behind reports R14's sentence instead of silently closing. After a write
 * the queue and the species are invalidated (`useRecordWrite`), so a fully
 * resolved row leaves.
 * @rfc RFC-13 R2, R3, R5
 * @rfc RFC-65 R10, R14-R16
 */
export function DisputedPage() {
  const list = usePagedList(curationKeys.contested, (cursor, limit) =>
    fetchContested({ cursor, limit }),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const act = useRecordWrite<Pending, unknown>({
    write: run,
    onInvalidated: (result) => {
      if (pending && remainingNotice(pending, result) === null) setPending(null);
    },
  });
  const notice = pending ? remainingNotice(pending, act.data) : null;
  return (
    <>
      <PageHeader
        title="Contested records"
        description="Values a scientist has contested with a different value. Keep both, withdraw the contest, or withdraw the contested level or record."
      />
      <div className="flex flex-col gap-4">
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No open contests." />
        ) : null}
        {list.items.length > 0 ? (
          <DisputedTable
            items={list.items}
            onSelect={setOpen}
            onAction={(item, action) => {
              act.reset();
              setPending({ item, action });
            }}
          />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
      {pending ? (
        <ConfirmDialog
          {...question(pending)}
          pending={act.isPending}
          error={notice ?? (act.error ? actionErrorMessage(act.error) : null)}
          onConfirm={() => act.mutate(pending)}
          onClose={() => setPending(null)}
        />
      ) : null}
      <RecordDrawer recordId={open} onClose={() => setOpen(null)} onOpenRecord={setOpen} />
    </>
  );
}
