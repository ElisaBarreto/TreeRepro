import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render.tsx';
import { SpeciesSearchForm, type SpeciesSearchValue } from './SpeciesSearchForm.tsx';

const dataset = vi.hoisted(() => ({ fetchFamilies: vi.fn(), fetchGenera: vi.fn() }));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

beforeEach(() => {
  dataset.fetchFamilies.mockReset();
  dataset.fetchGenera.mockReset();
  dataset.fetchFamilies.mockResolvedValue([]);
  dataset.fetchGenera.mockResolvedValue({ data: [], meta: { nextCursor: null } });
});

// The form is fully controlled; this wrapper stands in for the page that
// owns `value` so `onChange` has somewhere to land.
function Controlled({ initial }: { initial: SpeciesSearchValue }) {
  const [value, setValue] = useState(initial);
  return <SpeciesSearchForm value={value} onChange={setValue} />;
}

describe('RFC-13 R2, RFC-60 R6 SpeciesSearchForm genus chip', () => {
  it('shows a neutral fallback chip when genusId is set without a resolved genus name, and Clear removes it', async () => {
    renderWithProviders(<Controlled initial={{ q: '', unresolved: false, genusId: 'g1' }} />);
    expect(screen.getByText('Selected genus')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear genus' }));
    expect(screen.queryByText('Selected genus')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear genus' })).not.toBeInTheDocument();
  });
});
