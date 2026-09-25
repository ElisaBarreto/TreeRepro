import { useState } from 'react';
import { curationKeys, fetchDisputed } from '../../api/curation.ts';
import { DisputedTable } from '../../components/curation/DisputedTable.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { Alert, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/**
 * The disputed queue (RFC-65 R10): records whose review is `disputed`, newest
 * dispute first. A row opens the record drawer, whose actions resolve the dispute.
 * `?intent=contest` (plan 11b) narrows the queue to disputes a contest
 * generated and gives the page its own title and description, so the link
 * the workspace dashboard's Contested tile carries lands on a page that says
 * what it is showing — a contest is a competing value, not a scientist
 * stepping back from one.
 * @rfc RFC-13 R2
 * @rfc RFC-65 R10
 */
export function DisputedPage({ search }: { search: { intent?: 'contest' } }) {
  const list = usePagedList(curationKeys.disputed(search), (cursor, limit) =>
    fetchDisputed({ cursor, limit, intent: search.intent }),
  );
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title={search.intent === 'contest' ? 'Contested records' : 'Disputed records'}
        description={
          search.intent === 'contest'
            ? 'Records a scientist has answered with a competing value. Wait for the contest to be withdrawn.'
            : 'Records a scientist disputes. Wait for the disputer to step back.'
        }
      />
      <div className="flex flex-col gap-4">
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No standing disputes." />
        ) : null}
        {list.items.length > 0 ? (
          <DisputedTable records={list.items} onSelect={(record) => setOpen(record.id)} />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
      <RecordDrawer recordId={open} onClose={() => setOpen(null)} onOpenRecord={setOpen} />
    </>
  );
}
