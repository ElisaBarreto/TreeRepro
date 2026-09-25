import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReferenceDetail } from '@treerepro/contracts';
import { type ReactNode, useState } from 'react';
import { datasetKeys, fetchRecords, fetchReference } from '../../api/dataset.ts';
import { ReferenceDialog } from '../../components/catalog/ReferenceDialog.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { RecordTable } from '../../components/dataset/RecordTable.tsx';
import { useBreadcrumb } from '../../components/shell/Breadcrumb.tsx';
import { Alert, Button, Chip, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { detailErrorMessage, pageErrorMessage } from '../../lib/errors.ts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { doiHref, referenceLabel } from '../../lib/references.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const DASH = <span className="text-mist-500">—</span>;
const LINK = 'font-medium text-canopy-900 underline-offset-2 hover:underline break-all';

function errorMessage(error: unknown): string {
  return detailErrorMessage(error, 'REFERENCE_NOT_FOUND', 'This reference does not exist.');
}

// `1 record`, `2 records`, `1,237 records`.
function records(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? 'record' : 'records'}`;
}

/**
 * `blank` is only for the DOI link (RFC-80 R4's registry): it opens in a new
 * tab with `rel="noopener noreferrer"`, so leaving this reference does not
 * hand the registry a `window.opener` back into the app. A `url` field is
 * free text an import kept as-is, so it stays the plain `rel="noreferrer"`
 * link this page always showed.
 */
function ExternalLink({
  href,
  children,
  blank = false,
}: {
  href: string;
  children: ReactNode;
  blank?: boolean;
}) {
  return (
    <a
      href={href}
      target={blank ? '_blank' : undefined}
      rel={blank ? 'noopener noreferrer' : 'noreferrer'}
      className={LINK}
    >
      {children}
    </a>
  );
}

// A `url` field is free text from the import, not validated as a URL; only
// render it as a link when it is actually one the browser can follow.
function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
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
        <ExternalLink href={doiHref(reference.doi)} blank>
          {reference.doi}
        </ExternalLink>
      ) : (
        DASH
      ),
    },
    // A book only (RFC-61 R10): every other reference would read "—" here.
    ...(reference.isbn ? [{ label: 'ISBN', value: reference.isbn }] : []),
    {
      label: 'URL',
      value: reference.url ? (
        isHttpUrl(reference.url) ? (
          <ExternalLink href={reference.url}>{reference.url}</ExternalLink>
        ) : (
          reference.url
        )
      ) : (
        DASH
      ),
    },
  ];
}

function Metadata({ reference }: { reference: ReferenceDetail }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-cell">
      {metadataRows(reference).map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-mist-500">{row.label}</dt>
          <dd className="break-words text-canopy-950">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The full citation a curator wrote or R8 derived from Crossref, as its own
 * paragraph rather than a metadata row: it is prose meant to be read (or
 * copied) whole, not a single field among the others. Renders nothing when
 * the reference has none, which every reference before plan 10d and every
 * one an import has not enriched yet still is.
 * @rfc RFC-61 R4, R6, R8
 */
function FullCitation({ reference }: { reference: ReferenceDetail }) {
  if (!reference.fullCitation) return null;
  return <p className="max-w-3xl text-body text-canopy-900">{reference.fullCitation}</p>;
}

/**
 * The reference's usage by trait (R9's counters, visible traits only,
 * ordered by count): a chip per trait naming how many records cite this
 * article for it, linking to the trait page. Renders nothing when the
 * reference names no visible trait — a personal observation's own field
 * notes, or a reference no harmonised record has used yet — rather than an
 * empty heading. The chips are the one visibility-filtered thing on the
 * page: the per-role counts in the header count every viewer's records
 * alike (RFC-33 R3), so for a viewer who cannot see every trait the chips
 * need not add up to them.
 * @rfc RFC-61 R4, R9
 */
function Traits({ reference }: { reference: ReferenceDetail }) {
  if (reference.traits.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-section font-semibold text-canopy-950">Traits</h2>
      <ul aria-label="Traits" className="flex flex-wrap gap-2">
        {reference.traits.map(({ trait, recordCount }) => (
          <li key={trait.id}>
            <Link
              to="/app/traits/$id"
              params={{ id: trait.id }}
              className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
            >
              <Chip tone="amber">
                {humaniseKey(trait.key)}
                <span className="ml-1.5 text-bark-700/70">{records(recordCount)}</span>
              </Chip>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReferenceRecords({
  id,
  onSelectRecord,
}: {
  id: string;
  onSelectRecord: (recordId: string) => void;
}) {
  const list = usePagedList(datasetKeys.records({ referenceId: id }), (cursor, limit) =>
    fetchRecords({ referenceId: id, cursor, limit }),
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-section font-semibold text-canopy-950">
        Records citing this article
      </h2>
      {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
      {list.isLoading && !list.error ? (
        <p className="text-body text-mist-500">Loading records…</p>
      ) : null}
      {!list.isLoading && !list.error && list.items.length === 0 ? (
        <EmptyState title="No records cite this article yet." />
      ) : null}
      {list.items.length > 0 ? (
        <RecordTable
          records={list.items}
          onSelect={(record) => onSelectRecord(record.id)}
          showSpecies
          showTrait
        />
      ) : null}
      {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
    </section>
  );
}

/**
 * One bibliographic reference (RFC-61 R4): how it reads as the title — its
 * short citation or citation key, or "Personal observation (Name)" for the
 * reference a scientist's own field work is recorded under (RFC-61 R7),
 * whose key is an internal identity no contributor is shown — the full
 * citation as its own paragraph when one has been written or derived (R6,
 * R8), how many records cite it as the primary and as the secondary
 * article, the metadata the import kept with the DOI opening the registry in
 * a new tab, the traits it has been used for (R9), and every record that
 * names it in either role, one page at a time with the species, trait and
 * both articles of each row; a row opens the record in a drawer. The
 * records section mounts only once the reference resolved, so an unknown id
 * shows one alert and no empty list. An Edit action on the loaded header
 * opens `ReferenceDialog` for `references.manage`; the dialog's own
 * invalidation refreshes this reference. The label the header shows is
 * registered as the shell's trailing crumb, so the breadcrumb reads
 * `Data › References › <label>` once the reference resolved (RFC-13 R3).
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-61 R4, R6, R7, R8, R9, R10
 */
export function ReferencePage({ id }: { id: string }) {
  const me = useMe();
  const reference = useQuery({
    queryKey: datasetKeys.reference(id),
    queryFn: () => fetchReference(id),
  });
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useBreadcrumb(reference.data ? [{ label: referenceLabel(reference.data) }] : []);

  if (reference.isPending) {
    return (
      <>
        <PageHeader title="Reference" />
        <p className="text-body text-mist-500">Loading…</p>
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
        title={<span className="break-words">{referenceLabel(data)}</span>}
        description={`Used as the primary article in ${records(data.primaryCount)} and as the secondary article in ${records(data.secondaryCount)}.`}
        actions={
          hasPermission(me, 'references.manage') ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : undefined
        }
      />
      {editing ? (
        <ReferenceDialog
          reference={data}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
      <div className="flex flex-col gap-8">
        <FullCitation reference={data} />
        <Metadata reference={data} />
        <Traits reference={data} />
        <ReferenceRecords id={id} onSelectRecord={setOpenRecord} />
      </div>
      <RecordDrawer
        recordId={openRecord}
        onClose={() => setOpenRecord(null)}
        onOpenRecord={setOpenRecord}
      />
    </>
  );
}
