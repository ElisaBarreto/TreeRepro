import type { TraitSummary } from '@treerepro/contracts';
import { datasetKeys, fetchRecords } from '../../api/dataset.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { Alert, Drawer, EmptyState } from '../ui/index.ts';
import { Pagination } from './Pagination.tsx';
import { RecordTable } from './RecordTable.tsx';

/**
 * The records of one trait for one species, in a wide drawer: the accepted
 * value (RFC-65 R6) above one page at a time of
 * `GET /api/records?speciesId&traitId` (RFC-63 R9) rendered as a
 * `RecordTable` without the species and trait columns, which the page and
 * the title already name, its accepted row badged; a row hands its id back
 * so the page can open the record.
 * @rfc RFC-63 R9
 * @rfc RFC-65 R6
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
  const list = usePagedList(datasetKeys.records({ speciesId, traitId }), (cursor, limit) =>
    fetchRecords({ speciesId, traitId, cursor, limit }),
  );

  return (
    <Drawer open title={humaniseKey(summary.trait.key)} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-body text-mist-500">
          {summary.trait.unit ? `${summary.trait.unit} · ` : ''}
          {summary.recordCount} {summary.recordCount === 1 ? 'record' : 'records'}
        </p>
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading && !list.error ? (
          <p className="text-body text-mist-500">Loading records…</p>
        ) : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No records for this trait yet." />
        ) : null}
        {list.items.length > 0 ? (
          <RecordTable
            records={list.items}
            onSelect={(record) => onSelectRecord(record.id)}
            acceptedRecordId={summary.accepted?.recordId}
          />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
    </Drawer>
  );
}
