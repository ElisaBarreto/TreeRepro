import { useQuery } from '@tanstack/react-query';
import type { ImportBatch, ImportReject, ImportRejectReason } from '@treerepro/contracts';
import { useId } from 'react';
import { datasetKeys, fetchImport, fetchImportRejects } from '../../api/dataset.ts';
import { ImportStatusBadge } from '../../components/dataset/ImportStatusBadge.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { Alert, PageHeader, Table, Tbody, Td, Th, Thead, Tr } from '../../components/ui/index.ts';
import { detailErrorMessage, pageErrorMessage } from '../../lib/errors.ts';
import { formatDateTime, formatNumber } from '../../lib/format.ts';
import { type PagedList, usePagedList } from '../../lib/use-paged-list.ts';

const NUMBER = 'text-right tabular-nums';
const DASH = <span className="text-mist-500">—</span>;

const REASONS: Record<ImportRejectReason, string> = {
  no_species_name: 'No species name',
  unknown_trait: 'Unknown trait',
  no_reference: 'No reference',
  unknown_species: 'Unknown species',
  unknown_plot: 'Unknown plot',
  unknown_user: 'Unknown user',
  unknown_reference: 'Unknown reference',
  doi_taken: 'DOI already taken',
  invalid_value: 'Invalid value',
  invalid_record_id: 'Missing or malformed ID',
  duplicate_record_id: 'ID already used',
};

// The columns of the import file in file order (RFC-64 R2). A raw row is a
// JSON object, whose keys come back in no useful order, so the list is
// rendered in this order; any other key the API sends follows.
const RAW_ROW_COLUMNS = [
  'primary_reference',
  'secondary_reference',
  'wcvp_species',
  'wcvp_genus',
  'wcvp_family',
  'gbif_species',
  'gbif_usage_key',
  'original_species_name',
  'secondary_source_species_name',
  'original_trait_name',
  'final_standard_trait',
  'broad_category',
  'original_value_clean',
  'trait_value_type',
  'harmonised_value',
  'ID',
];

function orderedColumns(rawRow: Record<string, string>): string[] {
  const known = RAW_ROW_COLUMNS.filter((column) => column in rawRow);
  const rest = Object.keys(rawRow).filter((column) => !RAW_ROW_COLUMNS.includes(column));
  return [...known, ...rest];
}

/**
 * One import batch: its counts, the error when it failed, the unknown
 * levels the import met and, page by page, the rows it rejected with the raw
 * row each one carried.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-64 R11
 */
export function ImportPage({ id }: { id: string }) {
  const batch = useQuery({ queryKey: datasetKeys.importBatch(id), queryFn: () => fetchImport(id) });
  const rejects = usePagedList(
    datasetKeys.importRejects(id),
    (cursor, limit) => fetchImportRejects(id, { cursor, limit }),
    { enabled: batch.isSuccess },
  );

  if (batch.isPending) {
    return (
      <>
        <PageHeader title="Import" />
        <p className="text-body text-mist-500">Loading…</p>
      </>
    );
  }
  if (batch.isError) {
    return (
      <>
        <PageHeader title="Import" />
        <Alert tone="error">
          {detailErrorMessage(batch.error, 'IMPORT_NOT_FOUND', 'This import does not exist.')}
        </Alert>
      </>
    );
  }

  const data = batch.data;
  const description = [
    `Started ${formatDateTime(data.startedAt)}`,
    data.finishedAt ? `finished ${formatDateTime(data.finishedAt)}` : null,
    `run by ${data.runBy?.name ?? '—'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PageHeader
        title={data.fileName}
        description={description}
        actions={<ImportStatusBadge status={data.status} />}
      />
      <div className="flex flex-col gap-8">
        {data.status === 'failed' ? (
          <Alert tone="error">
            {data.error ? `This import failed: ${data.error}` : 'This import failed.'}
          </Alert>
        ) : null}
        <Counts batch={data} />
        <UnknownLevels batch={data} />
        <Rejects list={rejects} />
      </div>
    </>
  );
}

function Counts({ batch }: { batch: ImportBatch }) {
  const tiles: [string, number][] = [
    ['Total', batch.rowsTotal],
    ['Inserted', batch.rowsInserted],
    ['Duplicate', batch.rowsDuplicate],
    ['Already imported', batch.rowsAlreadyImported],
    ['Rejected', batch.rowsRejected],
    ['Pending', batch.rowsPending],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-canopy-700/15 bg-white px-4 py-3">
          <dt className="text-label font-bold uppercase tracking-[0.08em] text-canopy-800">
            {label}
          </dt>
          <dd className="mt-1 font-display text-title font-bold tabular-nums text-canopy-950">
            {formatNumber(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function UnknownLevels({ batch }: { batch: ImportBatch }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-display text-section font-semibold text-canopy-950">
        Unknown levels
      </h2>
      {batch.unknownLevels.length === 0 ? (
        <p className="text-body text-mist-500">None</p>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Trait</Th>
              <Th>Value</Th>
              <Th className={NUMBER}>Count</Th>
            </Tr>
          </Thead>
          <Tbody>
            {batch.unknownLevels.map((level) => (
              <Tr key={`${level.trait}::${level.value}`}>
                <Td className="font-medium text-canopy-900">{level.trait}</Td>
                <Td>{level.value}</Td>
                <Td className={NUMBER}>{formatNumber(level.count)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </section>
  );
}

function Rejects({ list }: { list: PagedList<ImportReject> }) {
  const { items, isLoading, error } = list;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-display text-section font-semibold text-canopy-950">
        Rejected rows
      </h2>
      {error ? <Alert tone="error">{pageErrorMessage(error)}</Alert> : null}
      {isLoading && !error ? <p className="text-body text-mist-500">Loading…</p> : null}
      {!isLoading && !error && items.length === 0 ? (
        <p className="text-body text-mist-500">None</p>
      ) : null}
      {items.length > 0 ? (
        <Table>
          <Thead>
            <Tr>
              <Th className={NUMBER}>Row</Th>
              <Th>Reason</Th>
              <Th>Raw row</Th>
            </Tr>
          </Thead>
          <Tbody>
            {items.map((reject) => (
              <Tr key={reject.id}>
                {/* A row number, not a quantity: no thousands separator. */}
                <Td className={NUMBER}>{reject.rowNo}</Td>
                <Td>{REASONS[reject.reason]}</Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-canopy-900 underline-offset-2 hover:underline">
                      Raw row
                    </summary>
                    <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-meta">
                      {orderedColumns(reject.rawRow).map((column) => (
                        <div key={column} className="contents">
                          <dt className="font-mono text-mist-500">{column}</dt>
                          <dd className="text-canopy-900">{reject.rawRow[column] || DASH}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
      {items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
    </section>
  );
}
