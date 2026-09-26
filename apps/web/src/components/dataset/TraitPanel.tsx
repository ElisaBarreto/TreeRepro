import type { RecordIntent, RecordItem, TraitSummary } from '@treerepro/contracts';
import { useState } from 'react';
import { datasetKeys, fetchRecords, type RecordSort, type SortOrder } from '../../api/dataset.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { Alert, Drawer, EmptyState } from '../ui/index.ts';
import { Pagination } from './Pagination.tsx';
import { RecordTable } from './RecordTable.tsx';
import { VoteButton } from './VoteButton.tsx';

/**
 * The records of one trait for one species, in a wide drawer: one page at a
 * time of `GET /api/records?speciesId&traitId&sort&order` (RFC-63 R9), newest
 * first until a sortable header says otherwise — a new column sorts
 * ascending, the same column again flips it, and either starts over at page
 * one. The table omits the species and trait columns, which the page and the
 * title already name; a row hands its id back so the page can open the
 * record. A quantitative trait's rows carry Validate/Contest/Complement
 * (spec §2) — a categorical trait's levels carry them on the card instead —
 * each present only when the page passes its handler, that is, when the
 * viewer holds the permission it needs.
 * @rfc RFC-63 R9
 * @rfc RFC-70 R1, R4
 */
export function TraitPanel({
  speciesId,
  summary,
  onClose,
  onSelectRecord,
  onValidateRecord,
  onRespondRecord,
}: {
  speciesId: string;
  summary: TraitSummary;
  onClose: () => void;
  onSelectRecord: (id: string) => void;
  onValidateRecord?: (record: RecordItem) => void;
  onRespondRecord?: (record: RecordItem, intent: RecordIntent) => void;
}) {
  const traitId = summary.trait.id;
  const [sort, setSort] = useState<{ by: RecordSort; order: SortOrder }>({
    by: 'added',
    order: 'desc',
  });
  const params = { speciesId, traitId, sort: sort.by, order: sort.order };
  const list = usePagedList(datasetKeys.records(params), (cursor, limit) =>
    fetchRecords({ ...params, cursor, limit }),
  );
  const withActions =
    summary.trait.valueType === 'quantitative' &&
    (onValidateRecord !== undefined || onRespondRecord !== undefined);

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
            sort={{
              ...sort,
              onSort: (by) =>
                setSort((prev) => ({
                  by,
                  order: prev.by === by && prev.order === 'asc' ? 'desc' : 'asc',
                })),
            }}
            extra={
              withActions
                ? {
                    header: 'Actions',
                    cell: (record) => (
                      <span className="flex gap-1.5">
                        {onValidateRecord ? (
                          <VoteButton
                            icon="thumbsUp"
                            label={`Validate ${record.recordCode}`}
                            onClick={() => onValidateRecord(record)}
                          />
                        ) : null}
                        {onRespondRecord ? (
                          <>
                            <VoteButton
                              icon="thumbsDown"
                              label={`Contest ${record.recordCode}`}
                              onClick={() => onRespondRecord(record, 'contest')}
                            />
                            <VoteButton
                              icon="plus"
                              label={`Complement ${record.recordCode}`}
                              onClick={() => onRespondRecord(record, 'complement')}
                            />
                          </>
                        ) : null}
                      </span>
                    ),
                  }
                : undefined
            }
          />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
    </Drawer>
  );
}
