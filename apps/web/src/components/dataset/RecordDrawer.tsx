import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  AcceptedDecision,
  AnnotationKind,
  RecordDetail,
  ReferenceRef,
} from '@treerepro/contracts';
import type { ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { datasetKeys, fetchRecord } from '../../api/dataset.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatNumber, humaniseKey, isoDate } from '../../lib/format.ts';
import { Alert, Badge, Drawer } from '../ui/index.ts';
import { HarmonisationBadge } from './HarmonisationBadge.tsx';
import { ReviewBadge } from './ReviewBadge.tsx';

const DASH = <span className="text-mist-500">—</span>;

const ANNOTATION_TONES: Record<AnnotationKind, 'neutral' | 'green' | 'red'> = {
  confirm: 'green',
  dispute: 'red',
  neutral: 'neutral',
  withdraw: 'neutral',
};
const DECISION_TONES: Record<AcceptedDecision, 'neutral' | 'green'> = {
  accepted: 'green',
  cleared: 'neutral',
};

const RAW_COLUMNS: ReadonlyArray<{
  key: keyof Pick<
    RecordDetail,
    | 'rawValue'
    | 'originalTraitName'
    | 'originalSpeciesName'
    | 'secondarySourceSpeciesName'
    | 'rawCategory'
  >;
  label: string;
}> = [
  { key: 'rawValue', label: 'Raw value' },
  { key: 'originalTraitName', label: 'Original trait name' },
  { key: 'originalSpeciesName', label: 'Original species name' },
  { key: 'secondarySourceSpeciesName', label: 'Secondary source species name' },
  { key: 'rawCategory', label: 'Raw category' },
];

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'RECORD_NOT_FOUND') {
    return 'This record does not exist.';
  }
  return pageErrorMessage(error);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-mist-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Definitions({ rows }: { rows: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-mist-500">{row.label}</dt>
          <dd className="break-words text-canopy-950">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReferenceLink({ reference }: { reference: ReferenceRef | null }) {
  if (!reference) return DASH;
  return (
    <Link
      to="/app/references/$id"
      params={{ id: reference.id }}
      className="font-medium text-canopy-900 underline-offset-2 hover:underline"
    >
      {reference.citationKey}
    </Link>
  );
}

function RecordBody({ record }: { record: RecordDetail }) {
  const unit = record.trait.unit;
  return (
    <div className="flex flex-col gap-6">
      <Section title="Value">
        <p className="font-display text-lg font-semibold text-canopy-950">
          {humaniseKey(record.trait.key)}
        </p>
        <Definitions
          rows={[
            { label: 'Value', value: record.valueText || DASH },
            ...(record.level ? [{ label: 'Level', value: record.level.key }] : []),
            ...(record.numericValue !== null
              ? [
                  {
                    label: 'Number',
                    value: `${formatNumber(record.numericValue)}${unit ? ` ${unit}` : ''}`,
                  },
                ]
              : []),
            ...(unit ? [{ label: 'Unit', value: unit }] : []),
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <HarmonisationBadge status={record.harmonisation} />
          <ReviewBadge status={record.review} />
        </div>
      </Section>

      <Section title="Source">
        <Definitions
          rows={[
            { label: 'Primary', value: <ReferenceLink reference={record.primaryReference} /> },
            {
              label: 'Secondary',
              value: <ReferenceLink reference={record.secondaryReference} />,
            },
            ...(record.note ? [{ label: 'Note', value: record.note }] : []),
          ]}
        />
      </Section>

      <Section title="Provenance">
        <Definitions
          rows={
            record.origin === 'import'
              ? [
                  { label: 'Origin', value: 'import' },
                  { label: 'Batch', value: record.importBatch?.fileName ?? DASH },
                  {
                    label: 'Started',
                    value: record.importBatch ? isoDate(record.importBatch.startedAt) : DASH,
                  },
                  { label: 'Row', value: record.importRowNo ?? DASH },
                ]
              : [
                  { label: 'Origin', value: 'manual' },
                  { label: 'Author', value: record.createdBy?.name ?? DASH },
                  { label: 'Date', value: isoDate(record.createdAt) },
                ]
          }
        />
      </Section>

      <Section title="Raw source columns">
        <Definitions
          rows={RAW_COLUMNS.map((column) => ({
            label: column.label,
            value: record[column.key] ?? DASH,
          }))}
        />
      </Section>

      <Section title="Annotations">
        {record.annotations.length === 0 ? (
          <p className="text-sm text-mist-500">No annotations yet</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {record.annotations.map((annotation) => (
              <li key={annotation.id} className="flex flex-col gap-1 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={ANNOTATION_TONES[annotation.kind]}>{annotation.kind}</Badge>
                  <span className="text-canopy-900">{annotation.actor.name}</span>
                  <time dateTime={annotation.createdAt} className="text-mist-500">
                    {isoDate(annotation.createdAt)}
                  </time>
                </span>
                {annotation.note ? (
                  <span className="text-canopy-950">{annotation.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Accepted history">
        {record.acceptedHistory.length === 0 ? (
          <p className="text-sm text-mist-500">No accepted value decisions yet</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {record.acceptedHistory.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={DECISION_TONES[entry.decision]}>{entry.decision}</Badge>
                  <span className="text-canopy-900">{entry.actor.name}</span>
                  <time dateTime={entry.createdAt} className="text-mist-500">
                    {isoDate(entry.createdAt)}
                  </time>
                </span>
                {entry.note ? <span className="text-canopy-950">{entry.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function RecordLoader({ id }: { id: string }) {
  const query = useQuery({ queryKey: datasetKeys.record(id), queryFn: () => fetchRecord(id) });
  if (query.error && !query.data) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  if (!query.data) return <p className="text-sm text-mist-500">Loading record…</p>;
  return <RecordBody record={query.data} />;
}

/**
 * One record in full (RFC-63 R8): its value and both status chips, the
 * references it comes from, where it came from (an import batch and row, or
 * the person who entered it), the source columns as imported, and the
 * curation trail — annotations and accepted-value decisions. Fetches only
 * while a record is selected.
 * @rfc RFC-63 R8
 */
export function RecordDrawer({
  recordId,
  onClose,
}: {
  recordId: string | null;
  onClose: () => void;
}) {
  return (
    <Drawer open={recordId !== null} title="Record" onClose={onClose}>
      {recordId !== null ? <RecordLoader id={recordId} /> : null}
    </Drawer>
  );
}
