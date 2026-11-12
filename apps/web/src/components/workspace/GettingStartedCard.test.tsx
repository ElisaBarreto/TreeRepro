import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTRIBUTION_SUMMARY, ZERO_CONTRIBUTION_SUMMARY } from '../../test/dataset-fixtures.ts';
import { renderSettled, withRouter } from '../../test/router.tsx';
import { GettingStartedCard } from './GettingStartedCard.tsx';

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

  it('RFC-72 R3 renders each step as a whole-card block link with its call to action', async () => {
    render(withRouter(<GettingStartedCard summary={ZERO_CONTRIBUTION_SUMMARY} />));
    const list = await screen.findByRole('list', { name: 'Getting started checklist' });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(4);
    for (const [link, cta] of links.map(
      (link, index) =>
        [link, ['Read the guide', 'Open your plots', 'Show gaps', 'Find traits'][index]] as const,
    )) {
      expect(link).toHaveClass('flex');
      expect(link).toHaveTextContent(cta ?? '');
    }
  });

  it('RFC-72 R3 opens straight on the checklist, with no introductory sentence', async () => {
    render(withRouter(<GettingStartedCard summary={ZERO_CONTRIBUTION_SUMMARY} />));
    await screen.findByRole('heading', { name: 'Getting started' });
    expect(screen.queryByText(/A few places to start/)).not.toBeInTheDocument();
  });

  it('offers no way to hide the card', async () => {
    render(withRouter(<GettingStartedCard summary={ZERO_CONTRIBUTION_SUMMARY} />));
    await screen.findByRole('heading', { name: 'Getting started' });
    expect(screen.queryByRole('button', { name: /hide/i })).not.toBeInTheDocument();
  });

  it('never renders when the summary has any non-zero count', async () => {
    await renderSettled(<GettingStartedCard summary={CONTRIBUTION_SUMMARY} />);
    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
  });

  // One case per field of ZERO_CONTRIBUTION_SUMMARY rather than a single
  // hand-picked field: RFC-73 R3 is "any" non-zero count, and hasNoContribution
  // &&-chains all seven checks, so a test that only ever set one particular
  // field non-zero would keep passing even if the &&-chain silently dropped
  // a check for a different field. Deriving the field list from the fixture
  // itself (instead of a hand-typed array of the seven names) means an
  // eighth field added to ContributionSummary later is covered here too,
  // without anyone remembering to update this test.
  it.each(Object.keys(ZERO_CONTRIBUTION_SUMMARY) as (keyof typeof ZERO_CONTRIBUTION_SUMMARY)[])(
    'never renders when only %s is non-zero',
    async (field) => {
      await renderSettled(
        <GettingStartedCard summary={{ ...ZERO_CONTRIBUTION_SUMMARY, [field]: 1 }} />,
      );
      expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
    },
  );

  it('shows again to a viewer who hid it before the button was removed', async () => {
    window.localStorage.setItem('treerepro.gettingStarted.hidden', 'true');
    render(withRouter(<GettingStartedCard summary={ZERO_CONTRIBUTION_SUMMARY} />));
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
  });
});
