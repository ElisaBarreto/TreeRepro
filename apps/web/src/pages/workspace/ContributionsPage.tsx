import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CONTRIBUTION_KINDS,
  type ContributionKind,
  type ContributionSummary,
  type Proposal,
  type ProposalStatus,
  type RecordIntent,
} from '@treerepro/contracts';
import { useState } from 'react';
import { adminKeys, fetchUser } from '../../api/admin.ts';
import {
  type ContributionItem,
  contributionKeys,
  fetchMyContributions,
  fetchMySummary,
  fetchUserContributions,
  fetchUserSummary,
  isContributionAnnotation,
  isContributionRecord,
} from '../../api/contributions.ts';
import { fetchMyProposals, proposalKeys } from '../../api/proposals.ts';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { RecordTable } from '../../components/dataset/RecordTable.tsx';
import {
  Alert,
  Badge,
  EmptyState,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { AnnotationTable } from '../../components/workspace/AnnotationTable.tsx';
import {
  ContributionFilters,
  type ContributionFiltersValue,
} from '../../components/workspace/ContributionFilters.tsx';
import { type StatTile, StatTiles } from '../../components/workspace/StatTiles.tsx';
import { pageErrorMessage } from '../../lib/errors.ts';
import { isoDate } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/**
 * Everything the contributions page carries in the URL: the tab, the five
 * filters and, for a manager, whose contributions are shown. The route's
 * `validateSearch` is what produces this shape; nothing else here is
 * trusted to.
 * @rfc RFC-71 R1, R5
 */
export interface ContributionsSearch extends ContributionFiltersValue {
  /**
   * `proposals` is the web app's own tab, not a `ContributionKind`: RFC-71's
   * two kinds are what `GET /api/me/contributions` answers, while the
   * proposals come from `GET /api/me/proposals` (RFC-75 R5). Keeping it out
   * of the contract enum is what stops that tab from ever being sent as a
   * `kind` the API does not know.
   */
  kind?: ContributionKind | 'proposals';
  userId?: string;
}

/**
 * The tab values the page understands: every contract kind, plus the one the
 * web app owns. Derived from `CONTRIBUTION_KINDS` rather than restated, so a
 * kind added to the contract keeps being validated by the route instead of
 * silently falling through to Records.
 * @rfc RFC-71 R1
 * @rfc RFC-75 R5
 */
export const CONTRIBUTION_TABS = [...CONTRIBUTION_KINDS, 'proposals'] as const;

const TABS: readonly { kind: ContributionKind; label: string }[] = [
  { kind: 'records', label: 'Records' },
  { kind: 'annotations', label: 'Annotations' },
];

/** How each proposal status reads in the Proposals tab. @rfc RFC-75 R6 */
const PROPOSAL_TONES: Record<ProposalStatus, 'amber' | 'green' | 'red'> = {
  open: 'amber',
  approved: 'green',
  rejected: 'red',
};

const TAB_CLASS =
  'rounded-full px-4 py-2 text-body font-semibold text-canopy-900 hover:bg-mist-100 aria-[current=page]:bg-canopy-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';

const DASH = <span className="text-mist-500">—</span>;

const INTENT_TONES: Record<RecordIntent, 'red' | 'neutral'> = {
  contest: 'red',
  complement: 'neutral',
};

// RFC-71 R4's four counts, in the order the rule lists them.
function tilesOf(summary: ContributionSummary): StatTile[] {
  return [
    { label: 'Records', value: summary.records },
    { label: 'Contests', value: summary.contests },
    { label: 'Complements', value: summary.complements },
    { label: 'Validations', value: summary.validations },
  ];
}

function emptyTitle(kind: ContributionKind | 'proposals', ofSomebodyElse: boolean): string {
  if (kind === 'proposals') return 'You have not proposed a species yet.';
  if (kind === 'records')
    return ofSomebodyElse ? 'No record matches.' : 'No record of yours matches.';
  return ofSomebodyElse ? 'No annotation matches.' : 'No annotation of yours matches.';
}

/**
 * One contributor's own work in one screen: the standing as small tiles, the
 * Records and Annotations tabs, and the filters — tab and filters alike are
 * URL params, so a filtered view can be shared and survives a reload.
 *
 * The tiles and the rows below them answer two different questions and may
 * disagree on purpose: the summary counts every row of the user's, while the
 * lists leave out records on species or traits the viewer may no longer see
 * (RFC-71 R4 against R2/R3). Neither is computed from the other.
 *
 * With `?userId=` the page shows another user's contributions through the
 * admin routes (RFC-71 R5; the route checks `contributions.read` before this
 * renders). The name comes from `GET /api/admin/users/:id` when the viewer
 * holds `users.read`, else from the first record's author — the annotations
 * tab cannot serve as that fallback, since the author of an annotated record
 * is whoever wrote the record, not whoever annotated it — and else from the
 * id itself.
 * @rfc RFC-13 R2, R3
 * @rfc RFC-71 R1, R2, R3, R4, R5
 */
export function ContributionsPage({
  search,
  onSearchChange,
}: {
  search: ContributionsSearch;
  onSearchChange: (next: ContributionsSearch) => void;
}) {
  const me = useMe();
  const userId = search.userId;
  // The Proposals tab is the viewer's own (RFC-75 R5): there is no route for
  // another user's proposals, and a viewer without `taxa.propose` has none.
  // A `?kind=proposals` that either rule refuses falls back to Records
  // rather than rendering a tab that is not offered.
  const canPropose = userId === undefined && hasPermission(me, 'taxa.propose');
  const asked = search.kind ?? 'records';
  const kind = asked === 'proposals' && !canPropose ? 'records' : asked;
  const showProposals = kind === 'proposals';
  const [open, setOpen] = useState<string | null>(null);

  const params = {
    kind: showProposals ? 'records' : kind,
    traitId: search.traitId,
    speciesId: search.speciesId,
    review: search.review,
    intent: search.intent,
    from: search.from,
    to: search.to,
  };
  const list = usePagedList<ContributionItem>(
    userId ? contributionKeys.user(userId, params) : contributionKeys.mine(params),
    (cursor, limit) =>
      userId
        ? fetchUserContributions(userId, { ...params, cursor, limit })
        : fetchMyContributions({ ...params, cursor, limit }),
    { enabled: !showProposals },
  );
  const proposals = usePagedList<Proposal>(
    proposalKeys.mine,
    (cursor, limit) => fetchMyProposals({ cursor, limit }),
    { enabled: showProposals },
  );
  const rows = showProposals ? proposals : list;
  const summary = useQuery({
    queryKey: userId ? contributionKeys.userSummary(userId) : contributionKeys.mySummary,
    queryFn: () => (userId ? fetchUserSummary(userId) : fetchMySummary()),
  });
  const user = useQuery({
    queryKey: adminKeys.user(userId ?? ''),
    queryFn: () => fetchUser(userId ?? ''),
    enabled: userId !== undefined && hasPermission(me, 'users.read'),
  });

  const records = list.items.filter(isContributionRecord);
  const annotations = list.items.filter(isContributionAnnotation);
  const title = userId
    ? `Contributions of ${user.data?.name ?? records[0]?.createdBy?.name ?? userId}`
    : 'My contributions';

  return (
    <>
      <PageHeader
        title={title}
        description={
          userId
            ? 'The records and annotations of this contributor.'
            : 'Everything you have recorded and everything you have annotated.'
        }
      />
      <div className="flex flex-col gap-6">
        {summary.isError ? <Alert tone="error">{pageErrorMessage(summary.error)}</Alert> : null}
        {summary.data ? <StatTiles label="Summary" tiles={tilesOf(summary.data)} /> : null}
        <nav aria-label="Contribution kind" className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <Link
              key={tab.kind}
              to="/app/contributions"
              search={{ ...search, kind: tab.kind }}
              aria-current={tab.kind === kind ? 'page' : undefined}
              className={TAB_CLASS}
            >
              {tab.label}
            </Link>
          ))}
          {canPropose ? (
            <Link
              to="/app/contributions"
              search={{ ...search, kind: 'proposals' }}
              aria-current={showProposals ? 'page' : undefined}
              className={TAB_CLASS}
            >
              Proposals
            </Link>
          ) : null}
        </nav>
        {showProposals ? null : (
          <ContributionFilters
            kind={kind}
            value={{
              traitId: search.traitId,
              speciesId: search.speciesId,
              review: search.review,
              intent: search.intent,
              from: search.from,
              to: search.to,
            }}
            onChange={(next) => onSearchChange({ ...search, ...next })}
          />
        )}
        {rows.error ? <Alert tone="error">{pageErrorMessage(rows.error)}</Alert> : null}
        {rows.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!rows.isLoading && !rows.error && rows.items.length === 0 ? (
          <EmptyState title={emptyTitle(kind, userId !== undefined)} />
        ) : null}
        {showProposals && proposals.items.length > 0 ? (
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Proposed</Th>
                <Th>Status</Th>
                <Th>Species</Th>
                <Th>Decision note</Th>
              </Tr>
            </Thead>
            <Tbody>
              {proposals.items.map((proposal) => (
                <Tr key={proposal.id}>
                  <Td className="font-medium text-canopy-950">{proposal.proposedName}</Td>
                  <Td className="tabular-nums">{isoDate(proposal.createdAt)}</Td>
                  <Td>
                    <Badge tone={PROPOSAL_TONES[proposal.status]}>{proposal.status}</Badge>
                  </Td>
                  <Td>
                    {proposal.species ? (
                      <Link
                        to="/app/species/$id"
                        params={{ id: proposal.species.id }}
                        className="font-medium text-canopy-950 underline decoration-canopy-700/30 underline-offset-2 hover:decoration-canopy-700"
                      >
                        {proposal.species.canonicalName}
                      </Link>
                    ) : (
                      DASH
                    )}
                  </Td>
                  <Td>{proposal.decisionNote ?? DASH}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : null}
        {kind === 'records' && records.length > 0 ? (
          <RecordTable
            records={records}
            onSelect={(record) => setOpen(record.id)}
            showSpecies
            showTrait
            extra={{
              header: 'Status',
              cell: (record) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  {record.intent ? (
                    <Badge tone={INTENT_TONES[record.intent]}>{record.intent}</Badge>
                  ) : null}
                  {record.responseCount > 0 ? (
                    <span className="text-meta text-mist-500">
                      {record.responseCount === 1 ? '1 answer' : `${record.responseCount} answers`}
                    </span>
                  ) : null}
                  {!record.intent && record.responseCount === 0 ? DASH : null}
                </span>
              ),
            }}
          />
        ) : null}
        {kind === 'annotations' && annotations.length > 0 ? (
          <AnnotationTable
            annotations={annotations}
            // A Keep-both resolution's `record` is null when its contest
            // created none, or one the viewer cannot see (RFC-71 R3): the
            // row then has nothing to open.
            onSelect={(annotation) => {
              if (annotation.record) setOpen(annotation.record.id);
            }}
          />
        ) : null}
        {rows.items.length > 0 || rows.page > 1 ? <Pagination pager={rows} /> : null}
      </div>
      <RecordDrawer recordId={open} onClose={() => setOpen(null)} onOpenRecord={setOpen} />
    </>
  );
}
