import { useState } from 'react';
import { curationKeys, fetchDisputed } from '../../api/curation.ts';
import { DisputedTable } from '../../components/curation/DisputedTable.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { Alert, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/**
 * The disputed queue (RFC-65 R10): records whose review is `disputed` and
 * whose species × trait has no later accepted decision, newest dispute
 * first. A row opens the record drawer, whose actions resolve the dispute.
 * @rfc RFC-13 R2
 * @rfc RFC-65 R10
 */
export function DisputedPage() {
  const list = usePagedList(curationKeys.disputed, (cursor, limit) =>
    fetchDisputed({ cursor, limit }),
  );
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Disputed records"
        description="Records a scientist disputes and no curator has decided on since. Set or clear the accepted value, or wait for the disputer to step back."
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
