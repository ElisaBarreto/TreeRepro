import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntroCard } from '../components/workspace/IntroCard.tsx';
import { DASHBOARD } from '../test/dataset-fixtures.ts';
import { renderWithProviders } from '../test/render.tsx';
import { withRouter } from '../test/router.tsx';
import { HomePage } from './HomePage.tsx';
import { InvitePage } from './InvitePage.tsx';

// RFC-13 R14: the pages as PlantRepro serves them.
vi.mock('../lib/platform.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/platform.ts')>();
  return {
    ...actual,
    currentPlatform: () => 'plantrepro' as const,
    platformCopy: (p?: 'treerepro' | 'plantrepro') => actual.platformCopy(p ?? 'plantrepro'),
  };
});
const auth = vi.hoisted(() => ({ login: vi.fn(), acceptInvite: vi.fn(), fetchMe: vi.fn() }));
vi.mock('../api/auth.ts', () => auth);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('RFC-13 R14 PlantRepro copy', () => {
  it('the landing page names PlantRepro and plants, with the forest emblem', () => {
    renderWithProviders(<HomePage onSignedIn={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'PlantRepro' })).toBeInTheDocument();
    expect(screen.getByText('Tracking how plants reproduce.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sign in to PlantRepro' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^PlantRepro emblem/ })).toBeInTheDocument();
    expect(screen.getByText(/© \d{4} PlantRepro/)).toBeInTheDocument();
    expect(screen.queryByText(/TreeRepro|trees/)).toBeNull();
  });

  it('the invitation page welcomes to PlantRepro', () => {
    renderWithProviders(<InvitePage token={'t'.repeat(43)} onAccepted={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Welcome to PlantRepro' })).toBeInTheDocument();
    expect(screen.getByText('PlantRepro')).toBeInTheDocument();
    expect(screen.queryByText(/TreeRepro/)).toBeNull();
  });

  it('the intro card reads PlantRepro and plants', async () => {
    render(withRouter(<IntroCard dataset={DASHBOARD.dataset} name="Ada" />));
    await screen.findByRole('region', { name: 'About PlantRepro' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Help complete what we know about how plants reproduce.',
    );
    expect(screen.getByText(/^PlantRepro is a collective data assembly/)).toHaveTextContent(
      'reproductive trait data for plants,',
    );
  });
});
