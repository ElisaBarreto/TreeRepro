import {
  DISPERSAL_PHASES,
  type DispersalPhase,
  type RecordIntent,
  type RecordItem,
  type TraitSummary,
} from '@treerepro/contracts';
import { type ReactNode, useId, useState } from 'react';
import { datasetKeys, fetchRecords, type RecordSort, type SortOrder } from '../../api/dataset.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { Alert, Drawer, EmptyState, Select } from '../ui/index.ts';
import { Pagination } from './Pagination.tsx';
import { DISPERSAL_PHASE_LABELS, RecordTable } from './RecordTable.tsx';
import { VoteButton } from './VoteButton.tsx';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The records a list asks for, and what its rows do. */
interface RecordListProps {
  speciesId: string;
  traitId: string;
  levelId?: string;
  dispersalPhase?: DispersalPhase;
  onSelectRecord: (id: string) => void;
  extra?: { header: string; cell: (record: RecordItem) => ReactNode };
}

/**
 * One page at a time of `GET /api/records?speciesId&traitId[&levelId]
 * [&dispersalPhase]&sort&order` (RFC-63 R9), newest first until a sortable
 * header says otherwise — a new column sorts ascending, the same column again
 * flips it, and either starts over at page one.
 */
function RecordList({
  speciesId,
  traitId,
  levelId,
  dispersalPhase,
  onSelectRecord,
  extra,
}: RecordListProps) {
  const [sort, setSort] = useState<{ by: RecordSort; order: SortOrder }>({
    by: 'added',
    order: 'desc',
  });
  const params = { speciesId, traitId, levelId, dispersalPhase, sort: sort.by, order: sort.order };
  const list = usePagedList(datasetKeys.records(params), (cursor, limit) =>
    fetchRecords({ ...params, cursor, limit }),
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
          extra={extra}
        />
      ) : null}
      {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
    </div>
  );
}

/** A button that opens and closes what it names, the list it holds rendered only while open. */
function Disclosure({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-3 rounded-[10px] border border-mist-200 px-3.5 py-2.5 text-left text-body text-canopy-900 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      >
        <span className="font-medium">
          <span aria-hidden="true">{open ? '▾' : '▸'} </span>
          {title}
        </span>{' '}
        <span className="text-meta tabular-nums text-mist-500">{meta}</span>
      </button>
      {open ? <div id={panelId}>{children}</div> : null}
    </li>
  );
}

/**
 * The records of one trait for one species, in a wide drawer. A categorical
 * trait whose levels the summary gives is grouped by level: each level names
 * its references and sources and opens on its own observations, each with its
 * ID and the datasets that also report it (RFC-63 R10, R17; issue #345); any
 * other trait is one list (RFC-63 R9). The table omits the species and trait
 * columns, which the page and the title already name; a row hands its id back
 * so the page can open the record. On a dispersal trait (`dispersal`) a
 * **Dispersal phase** select narrows every list to one phase. A quantitative
 * trait's rows carry Validate/Contest/Complement (spec §2) — a categorical
 * trait's levels carry them on the card instead — each present only when the
 * page passes its handler, that is, when the viewer holds the permission it
 * needs. Validate is further hidden on the viewer's own row, since the API
 * refuses to confirm it (spec R-6, mirroring {@link RecordActions}).
 * @rfc RFC-63 R9, R10, R17
 * @rfc RFC-65 R3
 * @rfc RFC-70 R1, R4
 */
export function TraitPanel({
  speciesId,
  summary,
  dispersal = false,
  onClose,
  onSelectRecord,
  onValidateRecord,
  onRespondRecord,
  isOwnRecord,
}: {
  speciesId: string;
  /** What the drawer reads of a trait card's summary; the trait page builds it from its own row. */
  summary: {
    trait: Pick<TraitSummary['trait'], 'id' | 'key' | 'unit' | 'valueType'>;
    recordCount: number;
    levels?: TraitSummary['levels'];
    categorical?: TraitSummary['categorical'];
    harmonisationCounts?: TraitSummary['harmonisationCounts'];
  };
  /** The trait is a dispersal trait, whose records may name their phase (RFC-63 R17). */
  dispersal?: boolean;
  onClose: () => void;
  onSelectRecord: (id: string) => void;
  onValidateRecord?: (record: RecordItem) => void;
  onRespondRecord?: (record: RecordItem, intent: RecordIntent) => void;
  /** True when the record was created by the viewer (spec R-6). */
  isOwnRecord?: (record: RecordItem) => boolean;
}) {
  const traitId = summary.trait.id;
  const [phase, setPhase] = useState<DispersalPhase | ''>('');
  const phaseId = useId();
  const withActions =
    summary.trait.valueType === 'quantitative' &&
    (onValidateRecord !== undefined || onRespondRecord !== undefined);
  const levels =
    summary.trait.valueType === 'categorical' && summary.levels && summary.levels.length > 0
      ? summary.levels
      : null;
  const list: Omit<RecordListProps, 'levelId'> = {
    speciesId,
    traitId,
    dispersalPhase: phase === '' ? undefined : phase,
    onSelectRecord,
    extra: withActions
      ? {
          header: 'Actions',
          cell: (record) => (
            <span className="flex gap-1.5">
              {onValidateRecord && !isOwnRecord?.(record) ? (
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
      : undefined,
  };
  const name = humaniseKey(summary.trait.key);
  const counts = summary.harmonisationCounts;
  const pending = counts
    ? counts.unknownLevel + counts.multiValue + counts.notNumeric + counts.empty
    : 0;
  // RFC-77 R7: a categorical trait counts its references, never its records.
  const counted =
    levels && summary.categorical
      ? plural(summary.categorical.nReferences, 'reference', 'references')
      : plural(summary.recordCount, 'record', 'records');

  return (
    <Drawer open title={name} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-body text-mist-500">
          {summary.trait.unit ? `${summary.trait.unit} · ` : ''}
          {counted}
        </p>
        {dispersal ? (
          <span className="flex items-center gap-3">
            <label htmlFor={phaseId} className="text-label font-semibold text-canopy-900">
              Dispersal phase
            </label>
            <Select
              id={phaseId}
              className="w-auto"
              value={phase}
              onChange={(e) => setPhase(e.target.value as DispersalPhase | '')}
            >
              <option value="">All phases</option>
              {DISPERSAL_PHASES.map((p) => (
                <option key={p} value={p}>
                  {DISPERSAL_PHASE_LABELS[p]}
                </option>
              ))}
            </Select>
          </span>
        ) : null}
        {levels ? (
          <ul aria-label={`Levels of ${name}`} className="flex flex-col gap-3">
            {levels.map((level) => (
              <Disclosure
                key={level.levelId}
                title={level.key}
                meta={`${plural(level.nReferences, 'reference', 'references')} · ${plural(level.nSources, 'source', 'sources')}`}
              >
                <RecordList {...list} levelId={level.levelId} />
              </Disclosure>
            ))}
            {pending > 0 ? (
              // A record pending harmonisation has no level yet; a reviewer reaches it here.
              <Disclosure
                title="All records"
                meta={`${plural(summary.recordCount, 'record', 'records')} · ${pending} pending`}
              >
                <RecordList {...list} />
              </Disclosure>
            ) : null}
          </ul>
        ) : (
          <RecordList {...list} />
        )}
      </div>
    </Drawer>
  );
}
