import { Link } from '@tanstack/react-router';
import { IMPORT_BATCH_KINDS, type ImportBatchKind } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, fetchImports } from '../../api/dataset.ts';
import { ImportStatusBadge } from '../../components/dataset/ImportStatusBadge.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  Alert,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatDateTime, formatNumber, humaniseKey } from '../../lib/format.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const DASH = <span className="text-mist-500">—</span>;
const NUMBER = 'text-right tabular-nums';

/**
 * Import batches, newest first and one page at a time, with the counts the
 * import computed and the kind of each batch; a Kind select filters the list
 * (RFC-68 R7). Requires `imports.read`; the route shows `NoPermission`
 * otherwise.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-64 R11
 * @rfc RFC-68 R7
 */
export function ImportsPage() {
  const ids = { kind: useId() };
  const [kind, setKind] = useState<ImportBatchKind | undefined>(undefined);
  const params = { kind };
  const list = usePagedList(datasetKeys.imports(params), (cursor, limit) =>
    fetchImports({ ...params, cursor, limit }),
  );

  return (
    <>
      <PageHeader title="Imports" description="Every run of the bulk import and its outcome." />
      <div className="flex flex-col gap-6">
        <div className="max-w-xs">
          <Field id={ids.kind} label="Kind">
            <Select
              id={ids.kind}
              value={kind ?? ''}
              onChange={(event) =>
                setKind((event.target.value || undefined) as ImportBatchKind | undefined)
              }
            >
              <option value="">All kinds</option>
              {IMPORT_BATCH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {humaniseKey(k)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No imports yet." />
        ) : null}
        {list.items.length > 0 ? (
          <Table>
            <Thead>
              <Tr>
                <Th>File</Th>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th>Started</Th>
                <Th>Run by</Th>
                <Th className={NUMBER}>Total</Th>
                <Th className={NUMBER}>Inserted</Th>
                <Th className={NUMBER}>Duplicate</Th>
                <Th className={NUMBER}>Rejected</Th>
                <Th className={NUMBER}>Pending</Th>
              </Tr>
            </Thead>
            <Tbody>
              {list.items.map((batch) => (
                <Tr key={batch.id}>
                  <Td>
                    <Link
                      to="/app/imports/$id"
                      params={{ id: batch.id }}
                      className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                    >
                      {batch.fileName}
                    </Link>
                  </Td>
                  <Td>{humaniseKey(batch.kind)}</Td>
                  <Td>
                    <ImportStatusBadge status={batch.status} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    <time dateTime={batch.startedAt}>{formatDateTime(batch.startedAt)}</time>
                  </Td>
                  <Td>{batch.runBy?.name ?? DASH}</Td>
                  <Td className={NUMBER}>{formatNumber(batch.rowsTotal)}</Td>
                  <Td className={NUMBER}>{formatNumber(batch.rowsInserted)}</Td>
                  <Td className={NUMBER}>{formatNumber(batch.rowsDuplicate)}</Td>
                  <Td className={NUMBER}>{formatNumber(batch.rowsRejected)}</Td>
                  <Td className={NUMBER}>{formatNumber(batch.rowsPending)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
    </>
  );
}
