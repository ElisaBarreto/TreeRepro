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
 * The curation section: two coverage meters and the queue tiles a reviewer
 * works from (spec §4). Rendered only while `curation` is not null (present
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Meter
          value={coverage.withData}
          max={coverage.cells}
          label="Species × trait cells with data"
        />
        <Meter
          value={coverage.accepted}
          max={coverage.cells}
          label="Species × trait cells with an accepted value"
        />
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
