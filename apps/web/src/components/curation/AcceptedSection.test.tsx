import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCEPTED_STATE,
  EMPTY_ACCEPTED,
  SEXUAL_SYSTEM,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { AcceptedSection } from './AcceptedSection.tsx';

const curation = vi.hoisted(() => ({
  fetchAccepted: vi.fn(),
  setAccepted: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));

beforeEach(() => {
  curation.fetchAccepted.mockReset().mockResolvedValue(ACCEPTED_STATE);
  curation.setAccepted.mockReset();
});

describe('RFC-65 R6, R11 AcceptedSection', () => {
  it('shows the current accepted value, its curator and note, and the history on demand', async () => {
    renderWithProviders(<AcceptedSection speciesId={SPECIES.id} traitId={SEXUAL_SYSTEM.id} />, {
      me: { ...ME, permissions: ['dataset.read'] },
    });
    expect(await screen.findByText('dioecious')).toBeInTheDocument();
    expect(screen.getByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByText('Best sampled population.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /history/i }));
    const list = screen.getByRole('list', { name: /accepted value history/i });
    expect(list.children).toHaveLength(2);
    expect(list).toHaveTextContent('cleared');
    expect(list).toHaveTextContent('Sources disagree.');
  });

  it('shows the empty state and no history button when nothing was decided', async () => {
    curation.fetchAccepted.mockResolvedValue(EMPTY_ACCEPTED);
    renderWithProviders(<AcceptedSection speciesId={SPECIES.id} traitId={SEXUAL_SYSTEM.id} />, {
      me: { ...ME, permissions: ['dataset.read'] },
    });
    expect(await screen.findByText('No accepted value yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /history/i })).not.toBeInTheDocument();
  });

  it('clears the accepted value with a required note (accepted.manage)', async () => {
    curation.setAccepted.mockResolvedValue(EMPTY_ACCEPTED);
    renderWithProviders(<AcceptedSection speciesId={SPECIES.id} traitId={SEXUAL_SYSTEM.id} />, {
      me: { ...ME, permissions: ['dataset.read', 'accepted.manage'] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm clear' }));
    expect(screen.getByText('A note is required.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'Sources disagree');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm clear' }));
    await waitFor(() =>
      expect(curation.setAccepted).toHaveBeenCalledWith(SPECIES.id, SEXUAL_SYSTEM.id, {
        decision: 'cleared',
        note: 'Sources disagree',
      }),
    );
    expect(curation.invalidateAfterRecordWrite).toHaveBeenCalledWith(expect.anything(), SPECIES.id);
  });

  it('resets the note when Cancel closes the clear form', async () => {
    renderWithProviders(<AcceptedSection speciesId={SPECIES.id} traitId={SEXUAL_SYSTEM.id} />, {
      me: { ...ME, permissions: ['dataset.read', 'accepted.manage'] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('');
  });
});
