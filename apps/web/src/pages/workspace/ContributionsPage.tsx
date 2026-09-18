import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ContributionKind, ContributionSummary, RecordIntent } from '@treerepro/contracts';
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
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { RecordTable } from '../../components/dataset/RecordTable.tsx';
import { Alert, Badge, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { AnnotationTable } from '../../components/workspace/AnnotationTable.tsx';
import {
  ContributionFilters,
  type ContributionFiltersValue,
} from '../../components/workspace/ContributionFilters.tsx';
import { type StatTile, StatTiles } from '../../components/workspace/StatTiles.tsx';
import { pageErrorMessage } from '../../lib/errors.ts';
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
  kind?: ContributionKind;
  userId?: string;
}

const TABS: readonly { kind: ContributionKind; label: string }[] = [
  { kind: 'records', label: 'Records' },
  { kind: 'annotations', label: 'Annotations' },
];

const TAB_CLASS =
  'rounded-full px-4 py-2 text-body font-semibold text-canopy-900 hover:bg-mist-100 aria-[current=page]:bg-canopy-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';

const DASH = <span className="text-mist-500">—</span>;

const INTENT_TONES: Record<RecordIntent, 'red' | 'neutral'> = {
  contest: 'red',
  complement: 'neutral',
};

// RFC-71 R4's seven counts, in the order the rule lists them.
function tilesOf(summary: ContributionSummary): StatTile[] {
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

function emptyTitle(kind: ContributionKind, ofSomebodyElse: boolean): string {
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
  const kind = search.kind ?? 'records';
  const userId = search.userId;
  const [open, setOpen] = useState<string | null>(null);

  const params = {
    kind,
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
  );
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
        <nav aria-label="Contribution kind" className="flex gap-2">
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
        </nav>
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
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title={emptyTitle(kind, userId !== undefined)} />
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
                  {record.isAccepted ? <Badge tone="green">accepted</Badge> : null}
                  {record.intent ? (
                    <Badge tone={INTENT_TONES[record.intent]}>{record.intent}</Badge>
                  ) : null}
                  {record.responseCount > 0 ? (
                    <span className="text-meta text-mist-500">
                      {record.responseCount === 1 ? '1 answer' : `${record.responseCount} answers`}
                    </span>
                  ) : null}
                  {!record.isAccepted && !record.intent && record.responseCount === 0 ? DASH : null}
                </span>
              ),
            }}
          />
        ) : null}
        {kind === 'annotations' && annotations.length > 0 ? (
          <AnnotationTable
            annotations={annotations}
            onSelect={(annotation) => setOpen(annotation.record.id)}
          />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
      <RecordDrawer recordId={open} onClose={() => setOpen(null)} onOpenRecord={setOpen} />
    </>
  );
}
