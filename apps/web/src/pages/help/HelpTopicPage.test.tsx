import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_ANCHORS, HELP_TOPICS } from '../../content/help/index.ts';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({ fetchMe: vi.fn() }));
vi.mock('../../api/auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/auth.ts')>()),
  fetchMe: auth.fetchMe,
}));

beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue(ME);
});

describe('RFC-73 R1, R2 HelpTopicPage', () => {
  it('renders the topic and its sections under the ids a help tip links to', async () => {
    const { container } = renderAt('/app/help/workflow');
    expect(await screen.findByRole('heading', { level: 1, name: 'Workflow' })).toBeInTheDocument();
    for (const id of ['validate', 'different', 'contest', 'complement', 'withdraw', 'review']) {
      const heading = container.querySelector(`#${id}`);
      expect(heading, `no heading carries id "${id}"`).not.toBeNull();
      expect(heading?.tagName).toBe('H2');
    }
  });

  it('registers the topic as the breadcrumb crumb after Help', async () => {
    renderAt('/app/help/workflow');
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/app/help');
    expect(within(trail).getByText('Workflow')).toHaveAttribute('aria-current', 'page');
  });

  it('renders the index for an unknown topic (RFC-73 R1)', async () => {
    renderAt('/app/help/no-such-topic');
    expect(await screen.findByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Help topics' });
    expect(within(list).getAllByRole('link')).toHaveLength(HELP_TOPICS.length);
  });

  it('RFC-75 R2 the missing-species section sends the reader to the propose flow', async () => {
    renderAt('/app/help/scope');
    await screen.findByRole('heading', { level: 1, name: 'Scope' });
    const link = screen.getByRole('link', { name: 'Species' });
    expect(link).toHaveAttribute('href', '/app/species');
    expect(screen.getByText(/Propose this species/)).toBeInTheDocument();
  });

  it('gives every anchor of HELP_ANCHORS a heading id in its own topic', async () => {
    for (const topic of HELP_TOPICS) {
      const { container, unmount } = renderAt(`/app/help/${topic.slug}`);
      await screen.findByRole('heading', { level: 1, name: topic.title });
      const anchors = HELP_ANCHORS[topic.slug];
      expect(anchors, `${topic.slug} has no anchors`).toBeDefined();
      expect(anchors?.length ?? 0).toBeGreaterThan(0);
      for (const id of anchors ?? []) {
        const heading = container.querySelector(`#${id}`);
        expect(heading, `${topic.slug} has no heading with id "${id}"`).not.toBeNull();
        expect(heading?.tagName).toBe('H2');
      }
      unmount();
    }
  });
});
