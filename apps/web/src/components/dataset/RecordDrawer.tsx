import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  AnnotationKind,
  RecordDetail,
  RecordIntent,
  ReferenceRef,
} from '@treerepro/contracts';
import type { ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { datasetKeys, fetchRecord } from '../../api/dataset.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatNumber, humaniseKey, isoDate } from '../../lib/format.ts';
import { referenceLabel } from '../../lib/references.ts';
import { RecordActions } from '../curation/RecordActions.tsx';
import { Alert, Badge, Drawer } from '../ui/index.ts';
import { DrawerSection } from './DrawerSection.tsx';
import { HarmonisationBadge } from './HarmonisationBadge.tsx';
import { ReviewBadge } from './ReviewBadge.tsx';

const DASH = <span className="text-mist-500">—</span>;

const ANNOTATION_TONES: Record<AnnotationKind, 'neutral' | 'green' | 'red'> = {
  confirm: 'green',
  dispute: 'red',
  neutral: 'neutral',
  withdraw: 'neutral',
  resolve: 'neutral',
};
// A contest says the value is wrong, a complement that both hold (RFC-70 R1);
// the verb reads the same on the record that answers and on the answers listed.
const INTENT_VERBS: Record<RecordIntent, string> = {
  contest: 'contests',
  complement: 'complements',
};
const INTENT_TONES: Record<RecordIntent, 'red' | 'neutral'> = {
  contest: 'red',
  complement: 'neutral',
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

function Definitions({ rows }: { rows: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-cell">
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
      {referenceLabel(reference)}
    </Link>
  );
}

// "Harmonises record …a1b2c3", "contests record …a1b2c3", "Open record
// …a1b2c3": the last six characters of the id name the record; a button when
// the caller can open it.
function RecordLink({
  id,
  verb,
  onOpen,
  // The intent link sits inside a `Badge`, whose own size it keeps.
  size = 'text-cell',
}: {
  id: string;
  verb: string;
  onOpen?: (id: string) => void;
  size?: 'text-cell' | 'text-label';
}) {
  const label = `${verb} record …${id.slice(-6)}`;
  if (!onOpen) return <span className={`${size} text-canopy-900`}>{label}</span>;
  return (
    <button
      type="button"
      className={`text-left ${size} font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500`}
      onClick={() => onOpen(id)}
    >
      {label}
    </button>
  );
}

function RecordBody({
  record,
  onOpenRecord,
  onClose,
}: {
  record: RecordDetail;
  onOpenRecord?: (id: string) => void;
  onClose?: () => void;
}) {
  const unit = record.trait.unit;
  return (
    <div className="flex flex-col gap-6">
      <DrawerSection title="Value">
        <p className="font-display text-section font-semibold text-canopy-950">
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
        <div className="flex flex-wrap items-center gap-2">
          <HarmonisationBadge status={record.harmonisation} />
          <ReviewBadge status={record.review} />
          {record.intent && record.respondsTo ? (
            <Badge tone={INTENT_TONES[record.intent]}>
              <RecordLink
                id={record.respondsTo.id}
                verb={INTENT_VERBS[record.intent]}
                onOpen={onOpenRecord}
                size="text-label"
              />
            </Badge>
          ) : null}
        </div>
      </DrawerSection>

      <RecordActions record={record} onOpenRecord={onOpenRecord} onGone={onClose} />

      <DrawerSection title="Source">
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
      </DrawerSection>

      <DrawerSection title="Provenance">
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
      </DrawerSection>

      {record.supersedes || record.supersededBy.length > 0 ? (
        <section aria-label="Harmonisation" className="flex flex-col gap-2">
          <h3 className="text-label font-bold uppercase tracking-[0.08em] text-mist-500">
            Harmonisation
          </h3>
          {record.supersedes ? (
            <RecordLink id={record.supersedes.id} verb="Harmonises" onOpen={onOpenRecord} />
          ) : null}
          {record.supersededBy.map((r) => (
            <RecordLink key={r.id} id={r.id} verb="Harmonised as" onOpen={onOpenRecord} />
          ))}
        </section>
      ) : null}

      {record.responses.length > 0 ? (
        <section aria-label="Responses" className="flex flex-col gap-2">
          <h3 className="text-label font-bold uppercase tracking-[0.08em] text-mist-500">
            Responses
          </h3>
          <ul className="flex flex-col gap-2">
            {record.responses.map((response) => (
              <li key={response.id} className="flex flex-wrap items-center gap-2 text-cell">
                <Badge tone={INTENT_TONES[response.intent]}>{INTENT_VERBS[response.intent]}</Badge>
                <span className="text-canopy-900">{response.createdBy?.name ?? DASH}</span>
                <time dateTime={response.createdAt} className="text-mist-500">
                  {isoDate(response.createdAt)}
                </time>
                <RecordLink id={response.id} verb="Open" onOpen={onOpenRecord} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DrawerSection title="Raw source columns">
        <Definitions
          rows={RAW_COLUMNS.map((column) => ({
            label: column.label,
            value: record[column.key] ?? DASH,
          }))}
        />
      </DrawerSection>

      <DrawerSection title="Annotations">
        {record.annotations.length === 0 ? (
          <p className="text-body text-mist-500">No annotations yet</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {record.annotations.map((annotation) => (
              <li key={annotation.id} className="flex flex-col gap-1 text-cell">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={ANNOTATION_TONES[annotation.kind]}>{annotation.kind}</Badge>
                  {annotation.generated ? <Badge tone="neutral">automatic</Badge> : null}
                  <span className="text-canopy-900">{annotation.actor.name}</span>
                  <time dateTime={annotation.createdAt} className="text-mist-500">
                    {isoDate(annotation.createdAt)}
                  </time>
                  {annotation.reference ? (
                    <span className="text-mist-500">
                      supported by{' '}
                      <em className="text-canopy-900">{referenceLabel(annotation.reference)}</em>
                    </span>
                  ) : null}
                </span>
                {annotation.note ? (
                  <span className="text-canopy-950">{annotation.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>
    </div>
  );
}

function RecordLoader({
  id,
  onOpenRecord,
  onClose,
}: {
  id: string;
  onOpenRecord?: (id: string) => void;
  onClose?: () => void;
}) {
  const query = useQuery({ queryKey: datasetKeys.record(id), queryFn: () => fetchRecord(id) });
  if (query.error && !query.data) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  if (!query.data) return <p className="text-body text-mist-500">Loading record…</p>;
  return <RecordBody record={query.data} onOpenRecord={onOpenRecord} onClose={onClose} />;
}

/**
 * One record in full (RFC-63 R8): its value and both status chips, the
 * curation actions the session may take on it, the references it comes
 * from, where it came from (an import batch and row, or the person who
 * entered it), the harmonisation link to the pending record it resolves or
 * the records that resolve it (buttons when `onOpenRecord` is given, plain
 * text otherwise), the source columns as imported, and the curation trail —
 * its annotations. Fetches only while a record is selected.
 * @rfc RFC-63 R8
 * @rfc RFC-65 R3, R4, R7
 */
export function RecordDrawer({
  recordId,
  onClose,
  onOpenRecord,
}: {
  recordId: string | null;
  onClose: () => void;
  onOpenRecord?: (id: string) => void;
}) {
  return (
    <Drawer open={recordId !== null} title="Record" onClose={onClose}>
      {recordId !== null ? (
        <RecordLoader id={recordId} onOpenRecord={onOpenRecord} onClose={onClose} />
      ) : null}
    </Drawer>
  );
}
