import { useQuery } from '@tanstack/react-query';
import type { ContributionSummary } from '@treerepro/contracts';
import { useState } from 'react';
import { dashboardKeys, fetchDashboard } from '../api/dashboard.ts';
import { RecordDrawer } from '../components/dataset/RecordDrawer.tsx';
import { Alert, ButtonLink, EmptyState } from '../components/ui/index.ts';
import { AwaitingTable } from '../components/workspace/AwaitingTable.tsx';
import { CurationCards } from '../components/workspace/CurationCards.tsx';
import { GettingStartedCard } from '../components/workspace/GettingStartedCard.tsx';
import { IntroCard } from '../components/workspace/IntroCard.tsx';
import { ScopeCard } from '../components/workspace/ScopeCard.tsx';
import { TraitsWithDataList } from '../components/workspace/TraitsWithDataList.tsx';
import { pageErrorMessage } from '../lib/errors.ts';
import { formatNumber } from '../lib/format.ts';
import { hasPermission, useMe } from '../lib/session.ts';

const CARD_CLASS =
  'flex flex-col gap-5 rounded-2xl border border-canopy-700/15 bg-white p-6 md:px-8 md:py-7';
const HEADING_CLASS = 'font-display text-section font-semibold text-canopy-950';

// RFC-71 R4's seven counts, in the order the rule lists them — the same
// order ContributionsPage's own tiles use, so the two screens agree.
function contributionCounts(summary: ContributionSummary): { label: string; value: number }[] {
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

function ContributionsCard({ summary }: { summary: ContributionSummary }) {
  const counts = contributionCounts(summary);
  return (
    <section aria-labelledby="contributions-heading" className={CARD_CLASS}>
      <h2 id="contributions-heading" className={HEADING_CLASS}>
        Your contributions
      </h2>
      {counts.every((count) => count.value === 0) ? (
        <div className="flex items-start gap-3.5 rounded-2xl border border-dashed border-pollen-500 bg-pollen-300/15 p-5">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-7 shrink-0 stroke-bark-700"
          >
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
          </svg>
          <p className="text-cell text-ink">
            Nothing yet. Validate a record or add a missing value and it counts here.
          </p>
        </div>
      ) : null}
      <ul aria-label="Your contributions" className="grid grid-cols-2 gap-x-6">
        {counts.map((count) => (
          <li
            key={count.label}
            className="flex items-baseline justify-between gap-2 border-b border-canopy-700/10 py-2.5"
          >
            <span className="text-cell text-canopy-800">{count.label}</span>
            <span className="font-display text-card font-bold tabular-nums text-canopy-950">
              {formatNumber(count.value)}
            </span>
          </li>
        ))}
      </ul>
      <div>
        <ButtonLink to="/app/contributions" variant="secondary">
          View your contributions
        </ButtonLink>
      </div>
    </section>
  );
}

/**
 * The workspace home as a dashboard (RFC-72 R1, spec §4): the dark intro
 * card — greeting, headline (the page's h1), what the project is, quick
 * actions and dataset counts — then the viewer's own plot scope, the records
 * waiting on their review, the first-run checklist, the traits with the most
 * data beside their own contributions and — for a reviewer — the curation
 * queues. The page reads one query; every section but "Top traits with data"
 * and "Your contributions" degrades independently when its part of the
 * answer is `null` (no plots, no review permission), rather than the page
 * failing whole.
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
      {query.error ? <Alert tone="error">{pageErrorMessage(query.error)}</Alert> : null}
      {query.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
      {data ? (
        <div className="flex flex-col gap-7">
          <IntroCard dataset={data.dataset} name={me.user.name} />
          {data.scope ? <ScopeCard scope={data.scope} /> : null}

          {data.contributor.awaitingValidation ? (
            <section aria-labelledby="awaiting-heading" className={CARD_CLASS}>
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

          <GettingStartedCard summary={data.contributor.summary} />

          <div className="grid items-start gap-6 lg:grid-cols-[7fr_5fr]">
            <section aria-labelledby="traits-with-data-heading" className={CARD_CLASS}>
              <div className="flex flex-col gap-1">
                <h2 id="traits-with-data-heading" className={HEADING_CLASS}>
                  Top traits with data
                </h2>
                <p className="text-meta text-mist-500">
                  Species with at least one record, across the whole dataset.
                </p>
              </div>
              {data.contributor.topTraitsWithData.length === 0 ? (
                <EmptyState title="No trait has data yet." />
              ) : (
                <TraitsWithDataList traits={data.contributor.topTraitsWithData} />
              )}
            </section>
            <ContributionsCard summary={data.contributor.summary} />
          </div>

          {data.curation ? (
            <CurationCards
              curation={data.curation}
              canReadCoverage={hasPermission(me, 'coverage.read')}
            />
          ) : null}
        </div>
      ) : null}
      <RecordDrawer recordId={open} onClose={() => setOpen(null)} onOpenRecord={setOpen} />
    </>
  );
}
