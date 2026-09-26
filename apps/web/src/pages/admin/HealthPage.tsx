import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { adminKeys, fetchPlatformHealth } from '../../api/admin.ts';
import { ActivityTable } from '../../components/admin/ActivityTable.tsx';
import { JobRow } from '../../components/admin/JobRow.tsx';
import { ImportStatusBadge } from '../../components/dataset/ImportStatusBadge.tsx';
import { NoPermission } from '../../components/shell/NoPermission.tsx';
import {
  Alert,
  EmptyState,
  Meter,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatDateTime, formatNumber, humaniseKey } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

const TILE_LABEL = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';
const TILE_VALUE = 'mt-1 font-display text-section font-bold tabular-nums text-canopy-950';
const TILE_CLASS = 'rounded-xl border border-canopy-700/15 bg-white px-4 py-3';
const SECTION_HEADING = 'font-display text-section font-semibold text-canopy-950';
const TILE_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5';

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <li className={TILE_CLASS}>
      <p className={TILE_LABEL}>{label}</p>
      <p className={TILE_VALUE}>{formatNumber(value)}</p>
    </li>
  );
}

/**
 * `value / max`, or `—` when there is nothing to divide by (ruling R-C — a
 * fresh install reaches this state on both meters below).
 */
function ratioLabel(value: number, max: number): string {
  return max > 0 ? `${formatNumber(value)} / ${formatNumber(max)}` : '—';
}

function MeterTile({
  label,
  meterLabel,
  value,
  max,
}: {
  label: string;
  meterLabel: string;
  value: number;
  max: number;
}) {
  return (
    <li className={TILE_CLASS}>
      <p className={TILE_LABEL}>{label}</p>
      <p className="mt-1 text-meta tabular-nums text-mist-500">{ratioLabel(value, max)}</p>
      <div className="mt-1.5">
        <Meter value={value} max={max} label={meterLabel} />
      </div>
    </li>
  );
}

/**
 * The platform's condition in one screen (RFC-52): tiles per group, the two
 * completeness meters, the 14-day activity table, the two job rows badged
 * per RFC-52 R3, and the five newest imports. Requires `health.read`; shows
 * `NoPermission` otherwise, before the query even mounts — the same
 * client-side gate `CoveragePage` uses for `coverage.read`.
 * @rfc RFC-13 R2, R3
 * @rfc RFC-52 R1, R2, R3
 */
export function HealthPage() {
  const me = useMe();
  const canRead = hasPermission(me, 'health.read');

  const health = useQuery({
    queryKey: adminKeys.health,
    queryFn: fetchPlatformHealth,
    enabled: canRead,
  });

  if (!canRead) return <NoPermission />;

  return (
    <>
      <PageHeader
        title="Platform health"
        description={
          <>
            Users, dataset, activity, queues, background jobs and the newest imports, in one
            snapshot.
            {health.data ? (
              // RFC-52 R1 caches the payload for a minute, so these numbers
              // can be up to that old. Without the stamp the operator has no
              // way to tell a fresh snapshot from a cached one.
              <>
                {' Computed '}
                <time dateTime={health.data.computedAt}>
                  {formatDateTime(health.data.computedAt)}
                </time>
                {' UTC, and cached for up to one minute.'}
              </>
            ) : null}
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {health.error ? <Alert tone="error">{pageErrorMessage(health.error)}</Alert> : null}
        {health.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}

        {health.data ? (
          <>
            <section aria-labelledby="health-users-heading" className="flex flex-col gap-3">
              <h2 id="health-users-heading" className={SECTION_HEADING}>
                Users
              </h2>
              <ul aria-label="User totals" className={TILE_GRID}>
                <StatTile label="Active" value={health.data.users.active} />
                <StatTile label="Invited" value={health.data.users.invited} />
                <StatTile label="Suspended" value={health.data.users.suspended} />
                <StatTile label="Signed in, 7d" value={health.data.users.signedInLast7d} />
                <StatTile label="Signed in, 30d" value={health.data.users.signedInLast30d} />
              </ul>
            </section>

            <section aria-labelledby="health-dataset-heading" className="flex flex-col gap-3">
              <h2 id="health-dataset-heading" className={SECTION_HEADING}>
                Dataset
              </h2>
              {/*
                RFC-52 R1: this group mixes two populations — the first four
                numbers count the whole catalog, deactivated rows included,
                the last four only the active one. Every label says which, so
                two adjacent numbers over different populations do not read as
                a bug.
              */}
              <ul aria-label="Dataset totals" className={TILE_GRID}>
                <StatTile label="Species (all)" value={health.data.dataset.species} />
                <StatTile label="Traits (all)" value={health.data.dataset.traits} />
                <StatTile label="References (all)" value={health.data.dataset.references} />
                <StatTile label="Records (all)" value={health.data.dataset.records} />
                <StatTile label="Species (active)" value={health.data.dataset.activeSpecies} />
                <StatTile label="Traits (active)" value={health.data.dataset.activeTraits} />
                <MeterTile
                  label="Validated of populated cells (active)"
                  meterLabel="Species × trait cells with a validated record, of the cells with any record"
                  value={health.data.dataset.validatedCells}
                  max={health.data.dataset.coverageCells}
                />
                <MeterTile
                  label="Populated of grid (active)"
                  meterLabel="Species × trait cells with a record, of the active species × active trait grid"
                  value={health.data.dataset.coverageCells}
                  max={health.data.dataset.activeSpecies * health.data.dataset.activeTraits}
                />
              </ul>
            </section>

            <section aria-labelledby="health-activity-heading" className="flex flex-col gap-3">
              <h2 id="health-activity-heading" className={SECTION_HEADING}>
                Activity
              </h2>
              {/*
                The window belongs to the tiles, not to the section: the table
                below them spans 14 days, and a heading reading "last 7 days"
                over it said so of both.
              */}
              <p className="text-meta text-mist-500">Last 7 days</p>
              <ul aria-label="Activity totals, last 7 days" className={TILE_GRID}>
                <StatTile label="Records" value={health.data.activity.records7d} />
                <StatTile label="Annotations" value={health.data.activity.annotations7d} />
                <StatTile label="Proposals" value={health.data.activity.proposals7d} />
              </ul>
              <ActivityTable byDay={health.data.activity.byDay} />
            </section>

            <section aria-labelledby="health-queues-heading" className="flex flex-col gap-3">
              <h2 id="health-queues-heading" className={SECTION_HEADING}>
                Queues
              </h2>
              <ul aria-label="Queue totals" className={TILE_GRID}>
                <StatTile label="Pending groups" value={health.data.queues.pendingGroups} />
                <StatTile label="Contested" value={health.data.queues.contested} />
                <StatTile label="Proposals" value={health.data.queues.proposals} />
              </ul>
            </section>

            <section aria-labelledby="health-jobs-heading" className="flex flex-col gap-3">
              <h2 id="health-jobs-heading" className={SECTION_HEADING}>
                Jobs
              </h2>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Job</Th>
                    <Th>Status</Th>
                    <Th>Started</Th>
                    <Th>Finished</Th>
                    <Th>Error</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  <JobRow label="Digest" run={health.data.jobs.digest} />
                  <JobRow label="Audit purge" run={health.data.jobs.auditPurge} />
                </Tbody>
              </Table>
            </section>

            <section aria-labelledby="health-imports-heading" className="flex flex-col gap-3">
              <h2 id="health-imports-heading" className={SECTION_HEADING}>
                Recent imports
              </h2>
              {health.data.imports.length === 0 ? (
                <EmptyState title="No imports yet." />
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>File</Th>
                      <Th>Kind</Th>
                      <Th>Status</Th>
                      <Th>Started</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {health.data.imports.map((batch) => (
                      <Tr key={batch.id}>
                        <Td>
                          <Link
                            to="/app/imports/$id"
                            params={{ id: batch.id }}
                            className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                          >
                            {batch.fileName}
                          </Link>
                        </Td>
                        <Td>{humaniseKey(batch.kind)}</Td>
                        <Td>
                          <ImportStatusBadge status={batch.status} />
                        </Td>
                        <Td className="whitespace-nowrap">
                          <time dateTime={batch.startedAt}>{formatDateTime(batch.startedAt)}</time>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
