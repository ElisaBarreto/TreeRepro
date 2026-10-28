import { useQuery } from '@tanstack/react-query';
import type { DispersalPhase, RecordGroup, RecordItem } from '@treerepro/contracts';
import { Fragment, useState } from 'react';
import { datasetKeys, fetchRecordGroups, fetchRecords } from '../../api/dataset.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { Alert, EmptyState, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';
import { Pagination } from './Pagination.tsx';
import { CountsCell, RecordRow, ReferenceLink } from './RecordTable.tsx';

const DASH = <span className="text-mist-500">—</span>;
// ponytail: an expanded group shows its first 200 entries (the API's page
// maximum); page inside a group if one ever holds more.
const GROUP_ENTRIES = 200;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Scope {
  speciesId: string;
  traitId: string;
  dispersalPhase?: DispersalPhase;
}

/** The entries of one expanded group, as nested record rows. */
function GroupEntries({
  scope,
  group,
  onSelect,
}: {
  scope: Scope;
  group: RecordGroup;
  onSelect: (record: RecordItem) => void;
}) {
  const params = {
    ...scope,
    levelId: group.level?.id,
    secondaryReferenceId: group.secondaryReference?.id ?? 'none',
    limit: GROUP_ENTRIES,
  };
  const query = useQuery({
    queryKey: datasetKeys.records(params),
    queryFn: () => fetchRecords(params),
  });
  if (query.error || query.isLoading) {
    return (
      <Tr>
        <Td colSpan={8} className="pl-8 text-mist-500">
          {query.error ? pageErrorMessage(query.error) : 'Loading entries…'}
        </Td>
      </Tr>
    );
  }
  return (query.data?.data ?? []).map((record) => (
    <RecordRow key={record.id} record={record} onSelect={onSelect} nested />
  ));
}

/** A group of several records: its level, secondary article and totals, expandable. */
function GroupRow({
  scope,
  group,
  onSelect,
}: {
  scope: Scope;
  group: RecordGroup;
  onSelect: (record: RecordItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tr className="transition-colors hover:bg-mist-50">
        <Td className="whitespace-nowrap">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
          >
            <span aria-hidden="true">{open ? '▾' : '▸'} </span>
            {plural(group.nRecords, 'entry', 'entries')}
          </button>
        </Td>
        <Td className="font-medium text-canopy-900">{group.level?.key ?? DASH}</Td>
        <Td>{plural(group.nReferences, 'reference', 'references')}</Td>
        <Td>
          {group.secondaryReference ? <ReferenceLink reference={group.secondaryReference} /> : DASH}
        </Td>
        <Td>{DASH}</Td>
        <Td>{DASH}</Td>
        <CountsCell
          validationCount={group.validationCount}
          contestCount={group.contestCount}
          contested={group.contested}
        />
        <Td>{DASH}</Td>
      </Tr>
      {open ? <GroupEntries scope={scope} group={group} onSelect={onSelect} /> : null}
    </>
  );
}

/**
 * A categorical trait's records as one table of groups (RFC-63 R18): a group
 * of one record is that record's row, a group of several — the entries one
 * secondary article gives for one level — a row of its totals that expands
 * into its entries, one page of groups at a time in the API's fixed order.
 * @rfc RFC-63 R18
 */
export function RecordGroupTable({
  speciesId,
  traitId,
  dispersalPhase,
  onSelect,
}: Scope & { onSelect: (record: RecordItem) => void }) {
  const scope = { speciesId, traitId, dispersalPhase };
  const list = usePagedList(datasetKeys.recordGroups(scope), (cursor, limit) =>
    fetchRecordGroups({ ...scope, cursor, limit }),
  );
  return (
    <div className="flex flex-col gap-4">
      {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
      {list.isLoading && !list.error ? (
        <p className="text-body text-mist-500">Loading records…</p>
      ) : null}
      {!list.isLoading && !list.error && list.items.length === 0 ? (
        <EmptyState title="No records for this trait yet." />
      ) : null}
      {list.items.length > 0 ? (
        <Table>
          <Thead>
            <Tr>
              <Th>ID</Th>
              <Th>Value</Th>
              <Th>References</Th>
              <Th>Secondary article</Th>
              <Th>Origin</Th>
              <Th>Harmonisation</Th>
              <Th>Counts</Th>
              <Th>Added</Th>
            </Tr>
          </Thead>
          <Tbody>
            {list.items.map((group) => (
              <Fragment
                key={`${group.level?.id ?? group.record?.id}:${group.secondaryReference?.id ?? 'none'}`}
              >
                {group.record ? (
                  <RecordRow record={group.record} onSelect={onSelect} />
                ) : (
                  <GroupRow scope={scope} group={group} onSelect={onSelect} />
                )}
              </Fragment>
            ))}
          </Tbody>
        </Table>
      ) : null}
      {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
    </div>
  );
}
