import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  APPROVED_PROPOSAL,
  PROPOSAL,
  PROPOSAL_LOOKUP_FAILED,
  REJECTED_PROPOSAL,
} from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  loginTotp: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
}));
const proposals = vi.hoisted(() => ({
  fetchProposals: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  invalidateAfterProposalWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/proposals.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/proposals.ts')>()),
  ...proposals,
}));

beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue({ ...ME, permissions: ['taxa.manage'] });
  proposals.fetchProposals
    .mockReset()
    .mockResolvedValue({ data: [PROPOSAL, PROPOSAL_LOOKUP_FAILED], meta: { nextCursor: null } });
  proposals.approveProposal.mockReset();
  proposals.rejectProposal.mockReset();
  proposals.invalidateAfterProposalWrite.mockClear();
});

describe('RFC-75 R3 ProposalsPage', () => {
  it('lists name, proposer, date and the lookup verdict, opening the queue on the open ones', async () => {
    renderAt('/app/curation/proposals');
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    expect(first).toHaveTextContent('Quercus robur');
    expect(first).toHaveTextContent('Ada');
    expect(first).toHaveTextContent('2026-09-19');
    expect(within(first).getByText('exact match')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('lookup failed')).toBeInTheDocument();
    expect(proposals.fetchProposals).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open' }),
    );
  });

  it('opens the drawer on a row and closes it after a decision, refreshing the queue', async () => {
    proposals.rejectProposal.mockResolvedValue(REJECTED_PROPOSAL);
    renderAt('/app/curation/proposals');
    const rows = (await screen.findAllByRole('row')).slice(1);
    await userEvent.click(
      within(rows[0] as HTMLElement).getByRole('button', { name: /Quercus robur/ }),
    );
    const panel = await screen.findByRole('dialog', { name: 'Proposal' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject' }));
    await userEvent.type(within(panel).getByRole('textbox', { name: /why/i }), 'No such taxon.');
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject proposal' }));
    await waitFor(() =>
      expect(proposals.rejectProposal).toHaveBeenCalledWith(PROPOSAL.id, {
        note: 'No such taxon.',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(proposals.invalidateAfterProposalWrite).toHaveBeenCalled();
  });

  it('RFC-75 R3 ?status= narrows the queue to decided proposals', async () => {
    proposals.fetchProposals.mockResolvedValue({
      data: [APPROVED_PROPOSAL],
      meta: { nextCursor: null },
    });
    renderAt('/app/curation/proposals?status=approved');
    await screen.findByText('approved');
    expect(proposals.fetchProposals).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
    );
    expect(screen.getByLabelText('Status')).toHaveValue('approved');
  });

  it('drops a status the API does not know', async () => {
    renderAt('/app/curation/proposals?status=whatever');
    await screen.findAllByRole('row');
    expect(proposals.fetchProposals).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open' }),
    );
  });

  it('shows the empty state when nothing is queued', async () => {
    proposals.fetchProposals.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    renderAt('/app/curation/proposals');
    expect(await screen.findByText('No proposal is waiting for a decision.')).toBeInTheDocument();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    proposals.fetchProposals.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = renderAt('/app/curation/proposals');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    first.unmount();

    proposals.fetchProposals.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderAt('/app/curation/proposals');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('RFC-13 R8 a 401 on the queue ends the session and returns to /', async () => {
    proposals.fetchProposals.mockRejectedValue(
      new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Authentication required'),
    );
    const { router } = renderAt('/app/curation/proposals');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
