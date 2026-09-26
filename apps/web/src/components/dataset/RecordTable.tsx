import { Link } from '@tanstack/react-router';
import type { RecordItem } from '@treerepro/contracts';
import { Fragment, type ReactNode } from 'react';
import type { RecordSort, SortOrder } from '../../api/dataset.ts';
import { formatNumber, humaniseKey, isoDate, truncate } from '../../lib/format.ts';
import { type LabelledReference, referenceLabel } from '../../lib/references.ts';
import { Badge, SortTh, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';
import { HarmonisationBadge } from './HarmonisationBadge.tsx';

const ARTICLE_MAX = 60;
const DASH = <span className="text-mist-500">—</span>;
const SORT_LABELS: Record<RecordSort, string> = {
  value: 'Value',
  references: 'References',
  origin: 'Origin',
  added: 'Added',
};

function bound(value: number | undefined): string {
  return value === undefined ? '…' : formatNumber(value);
}

/**
 * How a record's value reads: its level; else its quantitative value in the
 * trait's unit — the single value, the min–max range, the mean and the SD,
 * with n last (R-5) — else the text as it was entered.
 * @rfc RFC-63 R8
 */
export function recordValueLabel(record: RecordItem): string {
  if (record.level) return record.level.key;
  const q = record.quantitative;
  if (q) {
    const parts = [
      q.single === undefined ? null : formatNumber(q.single),
      q.min === undefined && q.max === undefined ? null : `${bound(q.min)}–${bound(q.max)}`,
      q.mean === undefined ? null : `mean ${formatNumber(q.mean)}`,
      q.sd === undefined ? null : `SD ${formatNumber(q.sd)}`,
    ].filter((part): part is string => part !== null);
    if (parts.length > 0) {
      const unit = record.trait.unit ? ` ${record.trait.unit}` : '';
      const n = q.n === undefined ? '' : ` (n = ${q.n})`;
      return `${parts.join(' · ')}${unit}${n}`;
    }
  }
  return record.valueText || '(empty)';
}

// One reference as it reads (RFC-61 R4 — a personal observation by its
// observer, never by its key) linked to its page, cut at sixty characters
// with the whole label in the link's `title`.
function ReferenceLink({ reference }: { reference: LabelledReference & { id: string } }) {
  const label = referenceLabel(reference);
  const shown = truncate(label, ARTICLE_MAX);
  return (
    <Link
      to="/app/references/$id"
      params={{ id: reference.id }}
      title={shown === label ? undefined : label}
      className="font-medium text-canopy-900 underline-offset-2 hover:underline"
    >
      {shown}
    </Link>
  );
}

/** The column and direction the list is ordered by, and how to change them. @rfc RFC-63 R9 */
export interface RecordTableSort {
  by: RecordSort;
  order: SortOrder;
  onSort(by: RecordSort): void;
}

/**
 * Records as rows: the record ID (R-2), the value — a button that selects the
 * row, so every record is reachable by keyboard — every reference of the
 * record joined by "; " (R-4), the import's secondary article, origin,
 * harmonisation, the validation and contest counts with a **Contested**
 * badge (R-9), and the date added. Withdrawn records never reach it (R-13).
 * With `sort`, the value, references, origin and added headers sort on the
 * server (spec §2). `showSpecies` / `showTrait` add leading columns outside a
 * species page or trait panel; `extra` appends one column of the caller's.
 * @rfc RFC-63 R8, R9
 * @rfc RFC-71 R2
 */
export function RecordTable<T extends RecordItem>({
  records,
  onSelect,
  showSpecies = false,
  showTrait = false,
  sort,
  extra,
}: {
  records: T[];
  onSelect: (record: T) => void;
  showSpecies?: boolean;
  showTrait?: boolean;
  sort?: RecordTableSort;
  extra?: { header: string; cell: (record: T) => ReactNode };
}) {
  const head = (by: RecordSort) =>
    sort ? (
      <SortTh
        label={SORT_LABELS[by]}
        direction={sort.by === by ? sort.order : null}
        onSort={() => sort.onSort(by)}
      />
    ) : (
      <Th>{SORT_LABELS[by]}</Th>
    );
  return (
    <Table>
      <Thead>
        <Tr>
          {showSpecies ? <Th>Species</Th> : null}
          {showTrait ? <Th>Trait</Th> : null}
          <Th>ID</Th>
          {head('value')}
          {head('references')}
          <Th>Secondary article</Th>
          {head('origin')}
          <Th>Harmonisation</Th>
          <Th>Counts</Th>
          {head('added')}
          {extra ? <Th>{extra.header}</Th> : null}
        </Tr>
      </Thead>
      <Tbody>
        {records.map((record) => (
          <Tr key={record.id} className="transition-colors hover:bg-mist-50">
            {showSpecies ? (
              <Td>
                <Link
                  to="/app/species/$id"
                  params={{ id: record.species.id }}
                  className="font-medium italic text-canopy-900 underline-offset-2 hover:underline"
                >
                  {record.species.canonicalName}
                </Link>
              </Td>
            ) : null}
            {showTrait ? <Td>{humaniseKey(record.trait.key)}</Td> : null}
            <Td className="whitespace-nowrap tabular-nums">{record.recordCode}</Td>
            <Td>
              <button
                type="button"
                onClick={() => onSelect(record)}
                className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
              >
                {recordValueLabel(record)}
              </button>
            </Td>
            <Td>
              {record.references.length === 0
                ? DASH
                : record.references.map((reference, index) => (
                    <Fragment key={reference.id}>
                      {index > 0 ? '; ' : null}
                      <ReferenceLink reference={reference} />
                    </Fragment>
                  ))}
            </Td>
            <Td>
              {record.secondaryReference ? (
                <ReferenceLink reference={record.secondaryReference} />
              ) : (
                DASH
              )}
            </Td>
            <Td>{record.origin}</Td>
            <Td>
              <HarmonisationBadge status={record.harmonisation} />
            </Td>
            <Td className="whitespace-nowrap">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="tabular-nums">
                  <span aria-hidden="true">{`✓ ${record.validationCount} / ✗ ${record.contestCount}`}</span>
                  <span className="sr-only">
                    {` (${record.validationCount} ${record.validationCount === 1 ? 'validation' : 'validations'}, ${record.contestCount} ${record.contestCount === 1 ? 'contest' : 'contests'})`}
                  </span>
                </span>
                {record.contested ? <Badge tone="red">Contested</Badge> : null}
              </span>
            </Td>
            <Td className="whitespace-nowrap tabular-nums">
              <time dateTime={record.createdAt}>{isoDate(record.createdAt)}</time>
            </Td>
            {extra ? <Td>{extra.cell(record)}</Td> : null}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
