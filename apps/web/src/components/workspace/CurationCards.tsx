import { Link, type LinkProps } from '@tanstack/react-router';
import type { Dashboard } from '@treerepro/contracts';
import { formatNumber } from '../../lib/format.ts';
import { buttonClassName } from '../ui/Button.tsx';
import { Meter } from '../ui/index.ts';

const TILE_CLASS =
  'rounded-xl border border-canopy-700/15 bg-white px-4 py-3 text-left transition-colors hover:bg-mist-50';
const TILE_LABEL_CLASS = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';
const TILE_VALUE_CLASS = 'mt-1 font-display text-section font-bold tabular-nums text-canopy-950';

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
    <Link to={to} search={search} className={TILE_CLASS}>
      <p className={TILE_LABEL_CLASS}>{label}</p>
      <p className={TILE_VALUE_CLASS}>{formatNumber(value)}</p>
    </Link>
  );
}

// The proposals queue (RFC-75) has no route yet — plan 12c ships it — so
// this stays a plain anchor rather than a typed router `Link`, same as the
// coverage link below (plan 11c). Both read from the fixed href a future
// plan's route file will answer to.
function ProposalsTile({ value }: { value: number }) {
  return (
    <a href="/app/curation/proposals" className={TILE_CLASS}>
      <p className={TILE_LABEL_CLASS}>Proposals</p>
      <p className={TILE_VALUE_CLASS}>{formatNumber(value)}</p>
    </a>
  );
}

/**
 * The curation section: two dataset-wide coverage meters and the queue tiles
 * a reviewer works from (spec §4). Rendered only while `curation` is not null (present
 * for `records.review` viewers, RFC-72 R1) — that null check belongs to the
 * caller. The proposals tile only appears once there are open proposals
 * (plan 12c has not shipped, so today that is never); the coverage link
 * only for a viewer who holds `coverage.read` (plan 11c).
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
      className="flex flex-col gap-4 rounded-xl border border-canopy-700/15 bg-white p-6"
    >
      <h2 id="curation-heading" className="font-display text-section font-semibold text-canopy-950">
        Curation
      </h2>
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
      <div className="flex flex-col gap-2.5">
        <p className="text-meta text-mist-500">
          Dataset-wide: every visible species and trait, not only your plots.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Meter
            value={coverage.withData}
            max={coverage.cells}
            percent={coverage.percentWithData}
            label="Species × trait cells with data"
          />
          <Meter
            value={coverage.accepted}
            max={coverage.cells}
            percent={coverage.percentAccepted}
            label="Species × trait cells with an accepted value"
          />
        </div>
      </div>
      <ul aria-label="Curation queues" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <li>
          <QueueTile label="Pending" value={queues.pendingGroups} to="/app/curation/pending" />
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
      {canReadCoverage ? (
        <div>
          <a href="/app/curation/coverage" className={buttonClassName({ variant: 'secondary' })}>
            View coverage
          </a>
        </div>
      ) : null}
    </section>
  );
}
