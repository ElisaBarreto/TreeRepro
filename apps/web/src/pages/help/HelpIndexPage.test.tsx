import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ME, ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({ fetchMe: vi.fn() }));
vi.mock('../../api/auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/auth.ts')>()),
  fetchMe: auth.fetchMe,
}));
const help = vi.hoisted(() => ({
  fetchHelpTopics: vi.fn(),
  fetchHelpTopic: vi.fn(),
  createHelpTopic: vi.fn(),
}));
vi.mock('../../api/help.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/help.ts')>()),
  ...help,
}));

const TOPICS = [
  {
    id: '018f6a5e-0000-7000-8000-000000000001',
    slug: 'workflow',
    title: 'Workflow',
    summary: 'How it works.',
  },
  { id: '018f6a5e-0000-7000-8000-000000000002', slug: 'faq', title: 'FAQ', summary: '' },
];

beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue(ME);
  help.fetchHelpTopics.mockReset().mockResolvedValue(TOPICS);
  help.fetchHelpTopic.mockReset();
  help.createHelpTopic.mockReset();
});

describe('RFC-73 R1, R2, R7 HelpIndexPage', () => {
  it('lists the stored topics with their summaries, each linking to its own page', async () => {
    renderAt('/app/help');
    const list = await screen.findByRole('list', { name: 'Help topics' });
    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(2));
    expect(within(list).getByRole('link', { name: 'Workflow' })).toHaveAttribute(
      'href',
      '/app/help/workflow',
    );
    expect(within(list).getByText('How it works.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New topic' })).not.toBeInTheDocument();
  });

  it('is reachable from the sidebar by a session holding no permission at all', async () => {
    renderAt('/app/help');
    const account = await screen.findByRole('navigation', { name: 'Account' });
    expect(within(account).getByRole('link', { name: 'Help' })).toHaveAttribute(
      'href',
      '/app/help',
    );
  });

  it('R7 a help.edit holder creates a topic and lands on it', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    const created = {
      id: '018f6a5e-0000-7000-8000-000000000003',
      slug: 'plots',
      title: 'Plots',
      summary: '',
      sections: [],
    };
    help.createHelpTopic.mockResolvedValue(created);
    help.fetchHelpTopic.mockResolvedValue(created);
    const { router } = renderAt('/app/help');
    await userEvent.click(await screen.findByRole('button', { name: 'New topic' }));
    await userEvent.type(screen.getByLabelText('Title'), 'Plots');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(help.createHelpTopic).toHaveBeenCalledWith({ title: 'Plots', summary: '' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/help/plots'));
  });
});
