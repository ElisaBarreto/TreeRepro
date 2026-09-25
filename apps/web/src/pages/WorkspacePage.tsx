import { useQuery } from '@tanstack/react-query';
import type { ContributionSummary } from '@treerepro/contracts';
import { useState } from 'react';
import { dashboardKeys, fetchDashboard } from '../api/dashboard.ts';
import { RecordDrawer } from '../components/dataset/RecordDrawer.tsx';
import { Alert, ButtonLink, EmptyState, PageHeader } from '../components/ui/index.ts';
import { AwaitingTable } from '../components/workspace/AwaitingTable.tsx';
import { CurationCards } from '../components/workspace/CurationCards.tsx';
import { GettingStartedCard } from '../components/workspace/GettingStartedCard.tsx';
import { IntroCard } from '../components/workspace/IntroCard.tsx';
import { QuickActions } from '../components/workspace/QuickActions.tsx';
import { ScopeCard } from '../components/workspace/ScopeCard.tsx';
import { type StatTile, StatTiles } from '../components/workspace/StatTiles.tsx';
import { TraitsWithDataList } from '../components/workspace/TraitsWithDataList.tsx';
import { pageErrorMessage } from '../lib/errors.ts';
import { useMe } from '../lib/session.ts';

const SECTION_CLASS = 'flex flex-col gap-4 rounded-xl border border-canopy-700/15 bg-white p-6';
const HEADING_CLASS = 'font-display text-section font-semibold text-canopy-950';

// RFC-71 R4's seven counts, in the order the rule lists them — the same
// order ContributionsPage's own tiles use, so the two screens agree.
function contributionTiles(summary: ContributionSummary): StatTile[] {
  return [
    { label: 'Records', value: summary.records },
    { label: 'Contests', value: summary.contests },
    { label: 'Complements', value: summary.complements },
    { label: 'Validations', value: summary.validations },
    { label: 'Disputes', value: summary.disputes },
    { label: 'Withdrawn', value: summary.withdrawn },
    { label: 'Accepted', value: summary.accepted },
  ];
}

/**
 * The workspace home as a dashboard (RFC-72 R1, spec §4): what the project
 * is, the viewer's own plot scope, quick actions into the species list, the
 * records waiting on their review, the traits with the most data, their own
 * contributions and — for a reviewer — the curation queues. The page reads
 * one query; every section but "Top traits with data" and "Your
 * contributions" degrades independently when its part of the answer is
 * `null` (no plots, no review permission), rather than the page failing
 * whole.
 * @rfc RFC-13 R2
 * @rfc RFC-72 R1, R3
 */
export function WorkspacePage() {
  const me = useMe();
  const query = useQuery({ queryKey: dashboardKeys.mine, queryFn: fetchDashboard });
  const [open, setOpen] = useState<string | null>(null);
  const data = query.data;

  return (
    <>
      <PageHeader title="Workspace" description={`Welcome, ${me.user.name}.`} />
      {query.error ? <Alert tone="error">{pageErrorMessage(query.error)}</Alert> : null}
      {query.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
      {data ? (
        <div className="flex flex-col gap-6">
          <IntroCard dataset={data.dataset} />
          {data.scope ? <ScopeCard scope={data.scope} /> : null}
          <QuickActions />
          <GettingStartedCard summary={data.contributor.summary} />

          {data.contributor.awaitingValidation ? (
            <section aria-labelledby="awaiting-heading" className={SECTION_CLASS}>
              <h2 id="awaiting-heading" className={HEADING_CLASS}>
                Records awaiting your validation ({data.contributor.awaitingValidation.count})
              </h2>
              {data.contributor.awaitingValidation.records.length === 0 ? (
                <EmptyState title="Everything in your plots has been validated." />
              ) : (
                <AwaitingTable
                  records={data.contributor.awaitingValidation.records}
                  onSelect={(record) => setOpen(record.id)}
                />
              )}
            </section>
          ) : null}

          <section aria-labelledby="traits-with-data-heading" className={SECTION_CLASS}>
            <h2 id="traits-with-data-heading" className={HEADING_CLASS}>
              Top traits with data
            </h2>
            {data.contributor.topTraitsWithData.length === 0 ? (
              <EmptyState title="No trait has data yet." />
            ) : (
              <TraitsWithDataList traits={data.contributor.topTraitsWithData} />
            )}
          </section>

          <section aria-labelledby="contributions-heading" className={SECTION_CLASS}>
            <h2 id="contributions-heading" className={HEADING_CLASS}>
              Your contributions
            </h2>
            <StatTiles
              label="Your contributions"
              tiles={contributionTiles(data.contributor.summary)}
            />
            <div>
              <ButtonLink to="/app/contributions" variant="secondary">
                View your contributions
              </ButtonLink>
            </div>
          </section>

          {data.curation ? (
            <CurationCards
              curation={data.curation}
              // 'coverage.read' is plan 11c's permission key; it does not
              // exist in the shared PermissionKey catalog yet (11c has not
              // shipped, and this worktree owns apps/web only), so the raw
              // string list is read directly rather than through
              // `hasPermission`, which is typed to the current catalog.
              canReadCoverage={me.permissions.includes('coverage.read')}
            />
          ) : null}
        </div>
      ) : null}
      <RecordDrawer recordId={open} onClose={() => setOpen(null)} onOpenRecord={setOpen} />
    </>
  );
}
