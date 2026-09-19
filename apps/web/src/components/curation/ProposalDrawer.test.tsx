import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  APPROVED_PROPOSAL,
  PROPOSAL,
  PROPOSAL_LOOKUP_FAILED,
  REJECTED_PROPOSAL,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { renderSettled, withRouter } from '../../test/router.tsx';
import { ProposalDrawer } from './ProposalDrawer.tsx';

const proposals = vi.hoisted(() => ({
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  invalidateAfterProposalWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/proposals.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/proposals.ts')>()),
  ...proposals,
}));
const catalog = vi.hoisted(() => ({ invalidateAfterCatalogWrite: vi.fn(async () => undefined) }));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

const REVIEWER = { ...ME, permissions: ['taxa.manage' as const] };

beforeEach(() => {
  proposals.approveProposal.mockReset();
  proposals.rejectProposal.mockReset();
  proposals.invalidateAfterProposalWrite.mockClear();
});

function mount(proposal = PROPOSAL, me = REVIEWER) {
  const onClose = vi.fn();
  const onDecided = vi.fn();
  renderWithProviders(
    withRouter(<ProposalDrawer proposal={proposal} onClose={onClose} onDecided={onDecided} />),
    { me },
  );
  return { onClose, onDecided };
}

const drawer = () => screen.findByRole('dialog', { name: 'Proposal' });

describe('RFC-75 R6 ProposalDrawer', () => {
  it('shows the proposed name, the proposer, the note and both lookup cards', async () => {
    mount();
    const panel = await drawer();
    expect(panel).toHaveTextContent('Quercus robur');
    expect(panel).toHaveTextContent('Ada');
    expect(panel).toHaveTextContent('Seen on plot A12, not in the catalog.');
    expect(within(panel).getByRole('region', { name: 'GBIF backbone' })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'WCVP' })).toBeInTheDocument();
    expect(within(panel).getByText('exact match')).toBeInTheDocument();
  });

  it('RFC-81 R3 a lookup that never ran says so, and shows no card at all', async () => {
    mount(PROPOSAL_LOOKUP_FAILED);
    const panel = await drawer();
    expect(within(panel).getByText('lookup failed')).toBeInTheDocument();
    expect(panel).toHaveTextContent(
      'The lookup could not be completed, so nothing was checked against GBIF. This says nothing about the name.',
    );
    expect(within(panel).queryByRole('region', { name: 'GBIF backbone' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('region', { name: 'WCVP' })).not.toBeInTheDocument();
  });

  it('RFC-75 R4 Approve opens the species dialog prefilled from the match and posts the approval', async () => {
    proposals.approveProposal.mockResolvedValue(APPROVED_PROPOSAL);
    const { onDecided } = mount();
    await userEvent.click(within(await drawer()).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve proposal' });
    expect(within(dialog).getByRole('textbox', { name: /canonical name/i })).toHaveValue(
      'Quercus robur',
    );
    expect(within(dialog).getByRole('combobox', { name: /name source/i })).toHaveValue('wcvp');
    expect(within(dialog).getByRole('textbox', { name: /^genus/i })).toHaveValue('Quercus');
    expect(within(dialog).getByRole('textbox', { name: /^family/i })).toHaveValue('Fagaceae');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and create' }));
    await waitFor(() =>
      expect(proposals.approveProposal).toHaveBeenCalledWith(PROPOSAL.id, {
        canonicalName: 'Quercus robur',
        nameSource: 'wcvp',
        genusName: 'Quercus',
        familyName: 'Fagaceae',
      }),
    );
    expect(onDecided).toHaveBeenCalledWith(APPROVED_PROPOSAL);
  });

  it('RFC-75 R4 an approval blocked by a species the proposer cannot see explains itself', async () => {
    proposals.approveProposal.mockRejectedValue(
      new ApiError(409, 'SPECIES_NAME_TAKEN', 'A species with this name already exists'),
    );
    mount();
    await userEvent.click(within(await drawer()).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve proposal' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and create' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('outside what the proposer can see');
    expect(alert).toHaveTextContent('the proposal is still open');
    expect(within(alert).getByRole('link', { name: /search the catalog/i })).toHaveAttribute(
      'href',
      '/app/species?q=Quercus+robur',
    );
  });

  it('RFC-75 R4 Reject asks for a note and refuses an empty one', async () => {
    proposals.rejectProposal.mockResolvedValue(REJECTED_PROPOSAL);
    const { onDecided } = mount();
    const panel = await drawer();
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject' }));
    const note = within(panel).getByRole('textbox', { name: /why/i });
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject proposal' }));
    expect(within(panel).getByText('Say why it is rejected.')).toBeInTheDocument();
    expect(proposals.rejectProposal).not.toHaveBeenCalled();

    await userEvent.type(note, 'No such taxon.');
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject proposal' }));
    await waitFor(() =>
      expect(proposals.rejectProposal).toHaveBeenCalledWith(PROPOSAL.id, {
        note: 'No such taxon.',
      }),
    );
    expect(onDecided).toHaveBeenCalledWith(REJECTED_PROPOSAL);
  });

  it('RFC-75 R6 a decided proposal shows its decision and offers no decision at all', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['auth', 'me'], REVIEWER);
    await renderSettled(
      (
        <QueryClientProvider client={queryClient}>
          <ProposalDrawer proposal={APPROVED_PROPOSAL} onClose={vi.fn()} onDecided={vi.fn()} />
        </QueryClientProvider>
      ) as ReactElement,
    );
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: SPECIES.canonicalName })).toHaveAttribute(
      'href',
      `/app/species/${SPECIES.id}`,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('RFC-13 R3 a viewer without taxa.manage sees the proposal but neither decision', async () => {
    mount(PROPOSAL, { ...ME, permissions: [] });
    const panel = await drawer();
    expect(panel).toHaveTextContent('Quercus robur');
    expect(within(panel).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('renders nothing without a proposal', () => {
    renderWithProviders(
      withRouter(<ProposalDrawer proposal={null} onClose={vi.fn()} onDecided={vi.fn()} />),
      { me: REVIEWER },
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
