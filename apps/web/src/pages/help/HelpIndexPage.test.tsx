import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_TOPICS, helpHref } from '../../content/help/index.ts';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

// The whole route tree is imported eagerly under Vitest (autoCodeSplitting is
// off), so only the session call the `/app` layout makes is mocked; nothing
// else on these two pages talks to the API.
const auth = vi.hoisted(() => ({ fetchMe: vi.fn() }));
vi.mock('../../api/auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/auth.ts')>()),
  fetchMe: auth.fetchMe,
}));

beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue(ME);
});

describe('RFC-73 R1, R2 HelpIndexPage', () => {
  it('lists the eight topics with their summaries, each linking to its own page', async () => {
    renderAt('/app/help');
    expect(await screen.findByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
    expect(HELP_TOPICS).toHaveLength(8);
    expect(HELP_TOPICS.map((topic) => topic.slug)).toEqual([
      'getting-started',
      'workflow',
      'vocabulary',
      'references',
      'scope',
      'contributions',
      'faq',
      'contact',
    ]);
    const list = screen.getByRole('list', { name: 'Help topics' });
    for (const topic of HELP_TOPICS) {
      expect(within(list).getByRole('link', { name: topic.title })).toHaveAttribute(
        'href',
        helpHref(topic.slug),
      );
      expect(within(list).getByText(topic.summary)).toBeInTheDocument();
    }
  });

  it('is reachable from the sidebar by a session holding no permission at all', async () => {
    renderAt('/app/help');
    const account = await screen.findByRole('navigation', { name: 'Account' });
    expect(within(account).getByRole('link', { name: 'Help' })).toHaveAttribute(
      'href',
      '/app/help',
    );
  });
});
