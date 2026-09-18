import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTRIBUTION_SUMMARY, ZERO_CONTRIBUTION_SUMMARY } from '../../test/dataset-fixtures.ts';
import { withRouter } from '../../test/router.tsx';
import { GettingStartedCard } from './GettingStartedCard.tsx';

const STORAGE_KEY = 'treerepro.gettingStarted.hidden';

function hrefUrl(href: string | null) {
  return new URL(href ?? '', 'https://example.org');
}

afterEach(() => {
  window.localStorage.clear();
});

describe('RFC-73 R3 GettingStartedCard', () => {
  it('renders the checklist when the contribution summary is all zeros', async () => {
    render(withRouter(<GettingStartedCard summary={ZERO_CONTRIBUTION_SUMMARY} />));
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();

    const workflow = hrefUrl(
      screen
        .getByRole('link', { name: /validating, contesting and complementing/i })
        .getAttribute('href'),
    );
    expect(workflow.pathname).toBe('/app/help/workflow');

    const plots = hrefUrl(
      screen.getByRole('link', { name: /species in your plots/i }).getAttribute('href'),
    );
    expect(plots.pathname).toBe('/app/species');
    expect(plots.searchParams.get('scope')).toBe('plots');

    const completeness = hrefUrl(
      screen.getByRole('link', { name: /least complete/i }).getAttribute('href'),
    );
    expect(completeness.pathname).toBe('/app/species');
    expect(completeness.searchParams.get('sort')).toBe('completeness');

    const missing = hrefUrl(
      screen.getByRole('link', { name: /missing data/i }).getAttribute('href'),
    );
    expect(missing.pathname).toBe('/app/species');
    expect(missing.searchParams.get('traitData')).toBe('missing');
  });

  it('writes the hidden flag and unmounts the card in the same interaction when "Hide this card" is clicked', async () => {
    const user = userEvent.setup();
    render(withRouter(<GettingStartedCard summary={ZERO_CONTRIBUTION_SUMMARY} />));
    await screen.findByRole('heading', { name: 'Getting started' });

    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBe('true');
    await user.click(screen.getByRole('button', { name: 'Hide this card' }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
  });

  it('never renders when the summary has any non-zero count', () => {
    render(withRouter(<GettingStartedCard summary={CONTRIBUTION_SUMMARY} />));
    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
  });

  it('never renders when a single field of the summary is non-zero', () => {
    render(
      withRouter(<GettingStartedCard summary={{ ...ZERO_CONTRIBUTION_SUMMARY, withdrawn: 1 }} />),
    );
    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
  });

  it('never renders when the hidden flag is already set, even with an all-zero summary', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    render(withRouter(<GettingStartedCard summary={ZERO_CONTRIBUTION_SUMMARY} />));
    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
  });
});
