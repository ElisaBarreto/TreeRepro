import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ME } from '../test/fixtures.ts';
import { renderWithProviders } from '../test/render.tsx';
import { WorkspacePage } from './WorkspacePage.tsx';

describe('RFC-13 R2 WorkspacePage', () => {
  it('greets the user and says what comes next', () => {
    renderWithProviders(<WorkspacePage />, { me: ME });
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByText('Research data arrives in the next release.')).toBeInTheDocument();
  });
});
