import { Link } from '@tanstack/react-router';
import { datasetKeys, fetchImports } from '../../api/dataset.ts';
import { ImportStatusBadge } from '../../components/dataset/ImportStatusBadge.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  Alert,
  EmptyState,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatDateTime, formatNumber } from '../../lib/format.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const DASH = <span className="text-mist-500">—</span>;
const NUMBER = 'text-right tabular-nums';

/**
 * Import batches, newest first and one page at a time, with the counts the
 * import computed. Requires `imports.read`; the route shows `NoPermission`
 * otherwise.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-64 R11
 */
export function ImportsPage() {
  const list = usePagedList(datasetKeys.imports, (cursor, limit) =>
    fetchImports({ cursor, limit }),
  );

  return (
    <>
      <PageHeader title="Imports" description="Every run of the bulk import and its outcome." />
      <div className="flex flex-col gap-6">
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-sm text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No imports yet." />
        ) : null}
        {list.items.length > 0 ? (
          <Table>
            <Thead>
              <Tr>
                <Th>File</Th>
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
