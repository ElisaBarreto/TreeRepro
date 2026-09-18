import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContributionSummary } from '@treerepro/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTRIBUTION_SUMMARY, ZERO_CONTRIBUTION_SUMMARY } from '../../test/dataset-fixtures.ts';
import { withRouter } from '../../test/router.tsx';
import { GettingStartedCard } from './GettingStartedCard.tsx';

const STORAGE_KEY = 'treerepro.gettingStarted.hidden';

function hrefUrl(href: string | null) {
  return new URL(href ?? '', 'https://example.org');
}

/**
 * Mounts the card next to a sentinel under the very route component
 * `withRouter` renders, then awaits the sentinel. `withRouter`'s own doc
 * comment warns its route mounts on its own tick: a synchronous
 * `queryByRole` taken right after `render(withRouter(...))` runs before that
 * tick, so it answers "not found" whether or not the card would ever have
 * rendered — a "never renders" assertion built that way is vacuous. Since
 * the sentinel sits next to the card inside the very same component
 * `withRouter` renders, its appearance proves that commit — the one
 * containing the card's own render decision — has already happened, so the
 * query that follows is checked against the real result.
 */
async function renderSettled(summary: ContributionSummary) {
  render(
    withRouter(
      <>
        <GettingStartedCard summary={summary} />
        <span data-testid="settled" />
      </>,
    ),
  );
  await screen.findByTestId('settled');
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

  it('never renders when the summary has any non-zero count', async () => {
    await renderSettled(CONTRIBUTION_SUMMARY);
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
      await renderSettled({ ...ZERO_CONTRIBUTION_SUMMARY, [field]: 1 });
      expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
    },
  );

  it('never renders when the hidden flag is already set, even with an all-zero summary', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    await renderSettled(ZERO_CONTRIBUTION_SUMMARY);
    expect(screen.queryByRole('heading', { name: 'Getting started' })).not.toBeInTheDocument();
  });
});
