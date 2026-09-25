import { Link, type LinkProps } from '@tanstack/react-router';
import type { Dashboard } from '@treerepro/contracts';
import { formatNumber } from '../../lib/format.ts';
import { Icon } from '../ui/Icon.tsx';

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';
// Every tile is a block-level link, so its border and corners hold as one box.
const TILE_CLASS = `flex h-full flex-col gap-2.5 rounded-2xl p-5.5 transition-colors ${FOCUS}`;
const LIGHT_TILE_CLASS = `${TILE_CLASS} border border-canopy-700/15 bg-white text-canopy-950 hover:border-canopy-700/40`;
const TILE_LABEL_CLASS = 'text-label font-bold uppercase tracking-[0.08em]';
const TILE_VALUE_CLASS = 'font-display text-title leading-none font-bold tabular-nums';

// A white queue's label and count; at zero, a check and "All clear".
function TileBody({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span className={`${TILE_LABEL_CLASS} text-canopy-800`}>{label}</span>
      <span className={TILE_VALUE_CLASS}>{formatNumber(value)}</span>
      {value === 0 ? (
        <span className="flex grow items-center gap-1.5 text-meta text-canopy-700">
          <Icon name="check" size={16} />
          All clear
        </span>
      ) : null}
    </>
  );
}

function QueueTile({
  label,
  value,
  to,
  search,
}: {
  label: string;
  value: number;
  to: LinkProps['to'];
  search?: LinkProps['search'];
}) {
  return (
    <Link to={to} search={search} className={LIGHT_TILE_CLASS}>
      <TileBody label={label} value={value} />
    </Link>
  );
}

// The reviewer's main queue, drawn as the dark call to action.
function PendingTile({ value }: { value: number }) {
  return (
    <Link
      to="/app/curation/pending"
      className={`${TILE_CLASS} bg-canopy-950 text-mist-50 hover:bg-canopy-900`}
    >
      <span className={`${TILE_LABEL_CLASS} text-pollen-300`}>Pending</span>
      <span className={TILE_VALUE_CLASS}>{formatNumber(value)}</span>
      <span className="grow text-meta text-mist-100">groups to harmonise</span>
      <span className="text-meta font-bold text-pollen-300">
        Start reviewing <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

// The proposals queue (RFC-75) has no route yet — plan 12c ships it — so
// this stays a plain anchor rather than a typed router `Link`, same as the
// coverage link below (plan 11c). Both read from the fixed href a future
// plan's route file will answer to.
function ProposalsTile({ value }: { value: number }) {
  return (
    <a href="/app/curation/proposals" className={LIGHT_TILE_CLASS}>
      <TileBody label="Proposals" value={value} />
    </a>
  );
}

// A coverage share as the big percentage over a bare bar. The native
// `<meter>` keeps the kit Meter's semantics (value against max, the specific
// accessible name); the kit Meter itself writes its percentage beside the
// bar in small type, which this panel sets large above it instead.
function CoverageMeter({
  title,
  label,
  value,
  max,
  percent,
}: {
  title: string;
  label: string;
  value: number;
  max: number;
  percent: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-cell font-semibold text-canopy-950">{title}</span>
        <span className="font-display text-section font-bold tabular-nums text-canopy-950">
          {percent}%
        </span>
      </div>
      <meter
        value={value}
        max={max}
        aria-label={label}
        className="meter-bar [--meter-height:0.625rem]"
      />
    </div>
  );
}

/**
 * The curation section: two dataset-wide coverage meters and the queue tiles
 * a reviewer works from (spec §4). Rendered only while `curation` is not null (present
 * for `records.review` viewers, RFC-72 R1) — that null check belongs to the
 * caller. Pending is the dark call to action; Disputed and Contested read
 * "All clear" at zero. The proposals tile only appears once there are open
 * proposals (plan 12c has not shipped, so today that is never); the coverage
 * link only for a viewer who holds `coverage.read` (plan 11c).
 * @rfc RFC-72 R3
 */
export function CurationCards({
  curation,
  canReadCoverage,
}: {
  curation: NonNullable<Dashboard['curation']>;
  canReadCoverage: boolean;
}) {
  const { coverage, queues } = curation;
  return (
    <section
      aria-labelledby="curation-heading"
      className="flex flex-col gap-5.5 rounded-2xl border border-canopy-700/15 bg-white p-6 md:px-8 md:py-7"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="curation-heading"
          className="font-display text-section font-semibold text-canopy-950"
        >
          Curation
        </h2>
        {canReadCoverage ? (
          <a
            href="/app/curation/coverage"
            className={`rounded-sm text-cell font-bold text-canopy-800 underline-offset-2 hover:underline ${FOCUS}`}
          >
            View coverage <span aria-hidden="true">→</span>
          </a>
        ) : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-[5fr_7fr]">
        {/*
          `coverage` is plot-blind by design while the queue counts below it are
          plot-scoped, and the two sit in one card: without the caption a
          plot-restricted reviewer reads a dataset-wide percentage as their own
          scope. It is visible text and not only an accessible name, because
          that misreading is a sighted one too. The caption names the group the
          meters sit in rather than being repeated into each `aria-label`, so a
          screen reader hears "dataset-wide" once on entering the group; and the
          wording stays here rather than in `Meter`, which knows nothing of
          scope and is reused by plans 11c and 12d. It is a plain paragraph
          ahead of the two meters and carries no ARIA of its own: naming a group
          with it would have a screen reader announce "dataset-wide" on entering
          the group and again when reading the paragraph, and each meter keeps
          its own specific label, so in reading order the caption is heard once
          and then what each bar measures.

          The percentages come from the API, which rounds halves up in integer
          arithmetic (RFC-69 R5); recomputing them here from the float would
          disagree with it by one on an exact half.
        */}
        <div className="flex flex-col gap-4.5 rounded-2xl bg-canopy-200/20 px-6 py-5.5">
          <p className="text-meta text-canopy-800">
            Dataset-wide: every visible species and trait, not only your plots.
          </p>
          <CoverageMeter
            title="Cells with data"
            label="Species × trait cells with data"
            value={coverage.withData}
            max={coverage.cells}
            percent={coverage.percentWithData}
          />
          <CoverageMeter
            title="Cells with an accepted value"
            label="Species × trait cells with an accepted value"
            value={coverage.accepted}
            max={coverage.cells}
            percent={coverage.percentAccepted}
          />
        </div>
        <ul
          aria-label="Curation queues"
          className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-4"
        >
          <li>
            <PendingTile value={queues.pendingGroups} />
          </li>
          <li>
            <QueueTile label="Disputed" value={queues.disputed} to="/app/curation/disputed" />
          </li>
          <li>
            <QueueTile
              label="Contested"
              value={queues.contested}
              to="/app/curation/disputed"
              search={{ intent: 'contest' }}
            />
          </li>
          {queues.proposals > 0 ? (
            <li>
              <ProposalsTile value={queues.proposals} />
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
