import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  APPROVED_PROPOSAL,
  LOOKUP_FUZZY,
  PROPOSAL,
  PROPOSAL_LOOKUP_FAILED,
} from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { ApproveProposalDialog } from './ApproveProposalDialog.tsx';

const proposals = vi.hoisted(() => ({
  approveProposal: vi.fn(),
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

beforeEach(() => {
  proposals.approveProposal.mockReset();
  proposals.invalidateAfterProposalWrite.mockClear();
  catalog.invalidateAfterCatalogWrite.mockClear();
});

function mount(proposal = PROPOSAL) {
  const onClose = vi.fn();
  const onApproved = vi.fn();
  renderWithProviders(
    withRouter(
      <ApproveProposalDialog proposal={proposal} onClose={onClose} onApproved={onApproved} />,
    ),
  );
  return { onClose, onApproved };
}

const dialog = () => screen.findByRole('dialog', { name: 'Approve proposal' });

describe('RFC-75 R4 ApproveProposalDialog', () => {
  it('posts the form to the approve endpoint and refreshes both the catalog and the queue', async () => {
    proposals.approveProposal.mockResolvedValue(APPROVED_PROPOSAL);
    const { onApproved } = mount();
    const form = await dialog();
    await userEvent.click(within(form).getByRole('button', { name: 'Approve and create' }));
    await waitFor(() =>
      expect(proposals.approveProposal).toHaveBeenCalledWith(PROPOSAL.id, {
        canonicalName: 'Quercus robur',
        nameSource: 'wcvp',
        genusName: 'Quercus',
        familyName: 'Fagaceae',
      }),
    );
    expect(catalog.invalidateAfterCatalogWrite).toHaveBeenCalledWith(expect.anything(), 'taxa');
    expect(proposals.invalidateAfterProposalWrite).toHaveBeenCalled();
    expect(onApproved).toHaveBeenCalledWith(APPROVED_PROPOSAL);
  });

  it('RFC-81 R3 a fuzzy backbone match opens on the spelling GBIF settled on, sourced gbif', async () => {
    mount({ ...PROPOSAL, proposedName: 'Quercus robour', lookup: LOOKUP_FUZZY });
    const form = await dialog();
    expect(within(form).getByRole('textbox', { name: /canonical name/i })).toHaveValue(
      'Quercus robur',
    );
    expect(within(form).getByRole('combobox', { name: /name source/i })).toHaveValue('gbif');
  });

  it('RFC-81 R3 a lookup that never ran opens on the proposed name, sourced original, with no taxa', async () => {
    mount(PROPOSAL_LOOKUP_FAILED);
    const form = await dialog();
    expect(within(form).getByRole('textbox', { name: /canonical name/i })).toHaveValue(
      'Pinus sylvestris',
    );
    expect(within(form).getByRole('combobox', { name: /name source/i })).toHaveValue('original');
    expect(within(form).getByRole('textbox', { name: /^genus/i })).toHaveValue('');
    expect(within(form).getByRole('textbox', { name: /^family/i })).toHaveValue('');
  });

  it('leaves an empty genus and family out of the body', async () => {
    proposals.approveProposal.mockResolvedValue(APPROVED_PROPOSAL);
    mount(PROPOSAL_LOOKUP_FAILED);
    await userEvent.click(
      within(await dialog()).getByRole('button', { name: 'Approve and create' }),
    );
    await waitFor(() =>
      expect(proposals.approveProposal).toHaveBeenCalledWith(PROPOSAL_LOOKUP_FAILED.id, {
        canonicalName: 'Pinus sylvestris',
        nameSource: 'original',
      }),
    );
  });

  it('RFC-13 R6 an empty canonical name is refused before any request', async () => {
    mount();
    const form = await dialog();
    await userEvent.clear(within(form).getByRole('textbox', { name: /canonical name/i }));
    await userEvent.click(within(form).getByRole('button', { name: 'Approve and create' }));
    expect(within(form).getByText('Enter the canonical name.')).toBeInTheDocument();
    expect(proposals.approveProposal).not.toHaveBeenCalled();
  });

  it('RFC-75 R4 PROPOSAL_DECIDED reads as itself, with no catalog-search link', async () => {
    proposals.approveProposal.mockRejectedValue(new ApiError(409, 'PROPOSAL_DECIDED', 'decided'));
    mount();
    await userEvent.click(
      within(await dialog()).getByRole('button', { name: 'Approve and create' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This proposal has already been decided. Reload the page.');
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument();
  });
});
