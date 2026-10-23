import {
  PROPOSAL_STATUSES,
  type Proposal,
  type ProposalSort,
  type ProposalStatus,
  type SortOrder,
} from '@treerepro/contracts';
import { useId, useState } from 'react';
import { fetchProposals, proposalKeys } from '../../api/proposals.ts';
import { LookupBadge } from '../../components/curation/LookupCard.tsx';
import { ProposalDrawer } from '../../components/curation/ProposalDrawer.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  Alert,
  EmptyState,
  Field,
  PageHeader,
  Select,
  SortTh,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { isoDate } from '../../lib/format.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';
import { toggleSort } from '../../lib/use-sort.ts';

/** The queue's status and order, in the URL. @rfc RFC-75 R3 */
export interface ProposalsSearch {
  status?: ProposalStatus;
  /** Newest first when absent (RFC-75 R3, RFC-13 R13). */
  sort?: ProposalSort;
  order?: SortOrder;
}

const EMPTY: Record<ProposalStatus, string> = {
  open: 'No proposal is waiting for a decision.',
  approved: 'No proposal has been approved.',
  rejected: 'No proposal has been rejected.',
};

/**
 * The reviewer's queue (RFC-75 R3): the open proposals newest first, each
 * with its proposer, the day it arrived and the verdict the stored lookup
 * reached. The verdict is the API's own (RFC-81 R3) — it is never recomputed
 * from `matchType` here, because `exact` means a match at species rank and a
 * genus name matching `EXACT` must not read as one.
 *
 * `status` is a URL param, so a link can open the decided proposals and the
 * choice survives a reload; the queue defaults to `open`, as the API does. A
 * row opens the drawer, and a decision closes it and refreshes the list.
 * @rfc RFC-13 R2, R3
 * @rfc RFC-75 R3, R4
 * @rfc RFC-81 R3
 */
export function ProposalsPage({
  search,
  onSearchChange,
}: {
  search: ProposalsSearch;
  onSearchChange: (next: ProposalsSearch) => void;
}) {
  const status = search.status ?? 'open';
  const statusId = useId();
  const [open, setOpen] = useState<Proposal | null>(null);
  const params = { status, sort: search.sort, order: search.order };
  const list = usePagedList(proposalKeys.list(params), (cursor, limit) =>
    fetchProposals({ ...params, cursor, limit }),
  );
  const current = {
    sort: search.sort ?? 'proposed',
    order: search.order ?? (search.sort ? 'asc' : 'desc'),
  } as const;
  const head = (by: 'name' | 'proposed', label: string) => (
    <SortTh
      label={label}
      direction={search.sort === by ? current.order : null}
      onSort={() => onSearchChange({ ...search, ...toggleSort<ProposalSort>(current, by) })}
    />
  );

  return (
    <>
      <PageHeader
        title="Species proposals"
        description="Names contributors have asked for, with what GBIF and, when configured, the World Checklist of Vascular Plants make of them. Approving one creates the species."
      />
      <div className="flex flex-col gap-6">
        <div className="max-w-56">
          <Field id={statusId} label="Status">
            <Select
              id={statusId}
              value={status}
              onChange={(e) =>
                onSearchChange({ ...search, status: e.target.value as ProposalStatus })
              }
            >
              {PROPOSAL_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading proposals…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title={EMPTY[status]} />
        ) : null}
        {list.items.length > 0 ? (
          <Table>
            <Thead>
              <Tr>
                {head('name', 'Name')}
                <Th>Proposer</Th>
                {head('proposed', 'Proposed')}
                <Th>Lookup</Th>
              </Tr>
            </Thead>
            <Tbody>
              {list.items.map((proposal) => (
                <Tr key={proposal.id}>
                  <Td>
                    <button
                      type="button"
                      onClick={() => setOpen(proposal)}
                      className="text-left font-medium text-canopy-950 underline decoration-canopy-700/30 underline-offset-2 hover:decoration-canopy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                    >
                      {proposal.proposedName}
                    </button>
                  </Td>
                  <Td>{proposal.proposer.name}</Td>
                  <Td className="tabular-nums">{isoDate(proposal.createdAt)}</Td>
                  <Td>
                    <LookupBadge lookup={proposal.lookup} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
      <ProposalDrawer
        proposal={open}
        onClose={() => setOpen(null)}
        onDecided={() => setOpen(null)}
      />
    </>
  );
}
