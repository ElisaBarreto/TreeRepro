import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { PROPOSAL, SPECIES } from '../../test/dataset-fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { ProposeSpeciesDialog } from './ProposeSpeciesDialog.tsx';

const proposals = vi.hoisted(() => ({
  createProposal: vi.fn(),
  invalidateAfterProposalWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/proposals.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/proposals.ts')>()),
  ...proposals,
}));

beforeEach(() => {
  proposals.createProposal.mockReset();
  proposals.invalidateAfterProposalWrite.mockClear();
});

function mount(name = 'Quercus robur') {
  const onClose = vi.fn();
  const onProposed = vi.fn();
  renderWithProviders(
    withRouter(<ProposeSpeciesDialog name={name} onClose={onClose} onProposed={onProposed} />),
  );
  return { onClose, onProposed };
}

async function dialog() {
  return await screen.findByRole('dialog', { name: 'Propose a species' });
}

describe('RFC-75 R2 ProposeSpeciesDialog', () => {
  it('prefills the name from the search term and posts it with the note', async () => {
    proposals.createProposal.mockResolvedValue(PROPOSAL);
    const { onProposed } = mount();
    const form = await dialog();
    expect(within(form).getByRole('textbox', { name: /species name/i })).toHaveValue(
      'Quercus robur',
    );
    await userEvent.type(within(form).getByRole('textbox', { name: /note/i }), 'Seen on plot A12.');
    await userEvent.click(within(form).getByRole('button', { name: 'Propose' }));
    await waitFor(() =>
      expect(proposals.createProposal).toHaveBeenCalledWith({
        name: 'Quercus robur',
        note: 'Seen on plot A12.',
      }),
    );
    expect(proposals.invalidateAfterProposalWrite).toHaveBeenCalled();
    expect(onProposed).toHaveBeenCalledWith(PROPOSAL);
  });

  it('leaves an empty note out of the body', async () => {
    proposals.createProposal.mockResolvedValue(PROPOSAL);
    mount();
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Propose' }));
    await waitFor(() =>
      expect(proposals.createProposal).toHaveBeenCalledWith({ name: 'Quercus robur' }),
    );
  });

  it('RFC-13 R6 a name under three characters is refused before any request', async () => {
    mount('Qu');
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Propose' }));
    expect(
      await screen.findByText('Enter at least three characters of the species name.'),
    ).toBeInTheDocument();
    expect(proposals.createProposal).not.toHaveBeenCalled();
  });

  it('RFC-75 R2 SPECIES_NAME_TAKEN links to the species the API names in details[0]', async () => {
    proposals.createProposal.mockRejectedValue(
      new ApiError(409, 'SPECIES_NAME_TAKEN', 'taken', [{ path: 'name', message: SPECIES.id }]),
    );
    mount();
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Propose' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This species exists — open it');
    expect(within(alert).getByRole('link', { name: 'open it' })).toHaveAttribute(
      'href',
      `/app/species/${SPECIES.id}`,
    );
  });

  it('RFC-75 R2 SPECIES_NAME_TAKEN without details still says the species exists, with no link', async () => {
    proposals.createProposal.mockRejectedValue(new ApiError(409, 'SPECIES_NAME_TAKEN', 'taken'));
    mount();
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Propose' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This species is already in the catalog.');
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument();
  });

  it('RFC-75 R2 PROPOSAL_EXISTS reads "Already proposed"', async () => {
    proposals.createProposal.mockRejectedValue(
      new ApiError(409, 'PROPOSAL_EXISTS', 'exists', [{ path: 'name', message: PROPOSAL.id }]),
    );
    mount();
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Propose' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already proposed.');
  });

  it('RFC-13 R4 any other failure gets the generic sentence', async () => {
    proposals.createProposal.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    mount();
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Propose' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});
