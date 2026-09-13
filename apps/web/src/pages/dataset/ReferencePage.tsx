import { useQuery } from '@tanstack/react-query';
import type { ReferenceDetail } from '@treerepro/contracts';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { datasetKeys, fetchRecords, fetchReference } from '../../api/dataset.ts';
import { LoadMore } from '../../components/dataset/LoadMore.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { RecordTable } from '../../components/dataset/RecordTable.tsx';
import { Alert, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { useCursorList } from '../../lib/use-cursor-list.ts';

const PAGE_SIZE = 50;
const DASH = <span className="text-mist-500">—</span>;
const LINK = 'font-medium text-canopy-900 underline-offset-2 hover:underline break-all';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'REFERENCE_NOT_FOUND') {
    return 'This reference does not exist.';
  }
  return pageErrorMessage(error);
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} rel="noreferrer" className={LINK}>
      {children}
    </a>
  );
}

// The bibliographic fields in citation order; a missing one reads "—".
function metadataRows(
  reference: ReferenceDetail,
): ReadonlyArray<{ label: string; value: ReactNode }> {
  return [
    { label: 'Title', value: reference.title ?? DASH },
    { label: 'Authors', value: reference.authors ?? DASH },
    { label: 'Year', value: reference.year ?? DASH },
    { label: 'Journal', value: reference.journal ?? DASH },
    {
      label: 'DOI',
      value: reference.doi ? (
        <ExternalLink href={`https://doi.org/${reference.doi}`}>{reference.doi}</ExternalLink>
      ) : (
        DASH
      ),
    },
    {
      label: 'URL',
      value: reference.url ? (
        <ExternalLink href={reference.url}>{reference.url}</ExternalLink>
      ) : (
        DASH
      ),
    },
  ];
}

function Metadata({ reference }: { reference: ReferenceDetail }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      {metadataRows(reference).map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-mist-500">{row.label}</dt>
          <dd className="break-words text-canopy-950">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReferenceRecords({
  id,
  onSelectRecord,
}: {
  id: string;
  onSelectRecord: (recordId: string) => void;
}) {
  const list = useCursorList(datasetKeys.records({ referenceId: id }), (cursor) =>
    fetchRecords({ referenceId: id, cursor, limit: PAGE_SIZE }),
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-canopy-950">
        Records from this reference
      </h2>
      {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
      {list.isLoading && !list.error ? (
        <p className="text-sm text-mist-500">Loading records…</p>
      ) : null}
      {!list.isLoading && !list.error && list.items.length === 0 ? (
        <EmptyState title="No records name this reference yet." />
      ) : null}
      {list.items.length > 0 ? (
        <RecordTable
          records={list.items}
          onSelect={(record) => onSelectRecord(record.id)}
          showSpecies
        />
      ) : null}
      <LoadMore
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
    </section>
  );
}

/**
 * One bibliographic reference (RFC-61 R4): its citation key as the title,
 * the metadata the import kept, and every record that names it as primary or
 * secondary source, page by page; a row opens the record in a drawer. The
 * records section mounts only once the reference resolved, so an unknown id
 * shows one alert and no empty list.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-61 R4
 */
export function ReferencePage({ id }: { id: string }) {
  const reference = useQuery({
    queryKey: datasetKeys.reference(id),
    queryFn: () => fetchReference(id),
  });
  const [openRecord, setOpenRecord] = useState<string | null>(null);

  if (reference.isPending) {
    return (
      <>
        <PageHeader title="Reference" />
        <p className="text-sm text-mist-500">Loading…</p>
      </>
    );
  }
  if (reference.isError) {
    return (
      <>
        <PageHeader title="Reference" />
        <Alert tone="error">{errorMessage(reference.error)}</Alert>
      </>
    );
  }

  const data = reference.data;
  return (
    <>
      <PageHeader
        title={<span className="break-words">{data.citationKey}</span>}
        description={`${data.recordCount} ${data.recordCount === 1 ? 'record' : 'records'}`}
      />
      <div className="flex flex-col gap-8">
        <Metadata reference={data} />
        <ReferenceRecords id={id} onSelectRecord={setOpenRecord} />
      </div>
      <RecordDrawer recordId={openRecord} onClose={() => setOpenRecord(null)} />
    </>
  );
}
