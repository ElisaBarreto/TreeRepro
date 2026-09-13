import type { TraitSummary } from '@treerepro/contracts';
import { datasetKeys, fetchRecords } from '../../api/dataset.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { useCursorList } from '../../lib/use-cursor-list.ts';
import { Alert, Drawer, EmptyState } from '../ui/index.ts';
import { LoadMore } from './LoadMore.tsx';
import { RecordTable } from './RecordTable.tsx';

const PAGE_SIZE = 50;

/**
 * The records of one trait for one species, in a wide drawer: a cursor list
 * over `GET /api/records?speciesId&traitId` (RFC-63 R9) rendered as a
 * `RecordTable`; a row hands its id back so the page can open the record.
 * @rfc RFC-63 R9
 */
export function TraitPanel({
  speciesId,
  summary,
  onClose,
  onSelectRecord,
}: {
  speciesId: string;
  summary: TraitSummary;
  onClose: () => void;
  onSelectRecord: (id: string) => void;
}) {
  const traitId = summary.trait.id;
  const list = useCursorList(datasetKeys.records({ speciesId, traitId }), (cursor) =>
    fetchRecords({ speciesId, traitId, cursor, limit: PAGE_SIZE }),
  );

  return (
    <Drawer open title={humaniseKey(summary.trait.key)} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-mist-500">
          {summary.trait.unit ? `${summary.trait.unit} · ` : ''}
          {summary.recordCount} {summary.recordCount === 1 ? 'record' : 'records'}
        </p>
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading && !list.error ? (
          <p className="text-sm text-mist-500">Loading records…</p>
        ) : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No records for this trait yet." />
        ) : null}
        {list.items.length > 0 ? (
          <RecordTable records={list.items} onSelect={(record) => onSelectRecord(record.id)} />
        ) : null}
        <LoadMore
          hasMore={list.hasMore}
          isLoadingMore={list.isLoadingMore}
          onLoadMore={list.loadMore}
        />
      </div>
    </Drawer>
  );
}
