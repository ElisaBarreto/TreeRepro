import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
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
  updateHelpSection: vi.fn(),
  createHelpSection: vi.fn(),
  deleteHelpSection: vi.fn(),
}));
vi.mock('../../api/help.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/help.ts')>()),
  ...help,
}));

const id = (n: number) => `018f6a5e-0000-7000-8000-00000000000${n}`;
const WORKFLOW = {
  id: id(1),
  slug: 'workflow',
  title: 'Workflow',
  summary: 'What each button does.',
  sections: [
    { id: id(2), anchor: null, title: '', bodyHtml: '<p>A record is never edited.</p>' },
    {
      id: id(3),
      anchor: 'contest',
      title: 'Contest',
      bodyHtml: '<p>See <a href="/app/help/faq">the FAQ</a>.</p>',
    },
  ],
};

beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue(ME);
  help.fetchHelpTopics.mockReset().mockResolvedValue([WORKFLOW]);
  help.fetchHelpTopic.mockReset().mockImplementation(async (slug: string) => {
    if (slug === 'workflow') return WORKFLOW;
    throw new ApiError(404, 'HELP_TOPIC_NOT_FOUND', 'Help topic not found');
  });
  help.updateHelpSection.mockReset();
  help.createHelpSection.mockReset();
  help.deleteHelpSection.mockReset();
});

describe('RFC-73 R1, R2 HelpTopicPage', () => {
  it('renders the stored sections, each titled one an h2 carrying its anchor', async () => {
    const { container } = renderAt('/app/help/workflow');
    expect(await screen.findByRole('heading', { level: 1, name: 'Workflow' })).toBeInTheDocument();
    expect(screen.getByText('A record is never edited.')).toBeInTheDocument();
    const heading = container.querySelector('#contest');
    expect(heading?.tagName).toBe('H2');
    expect(heading).toHaveTextContent('Contest');
  });

  it('registers the topic as the breadcrumb crumb after Help', async () => {
    renderAt('/app/help/workflow');
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    await waitFor(() => expect(within(trail).getByText('Workflow')).toBeInTheDocument());
    expect(within(trail).getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/app/help');
  });

  it('renders the index for an unknown topic (RFC-73 R1)', async () => {
    renderAt('/app/help/no-such-topic');
    expect(await screen.findByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
  });

  it('R8 a same-origin link in a body navigates inside the app', async () => {
    const { router } = renderAt('/app/help/workflow');
    await userEvent.click(await screen.findByRole('link', { name: 'the FAQ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/help/faq'));
  });

  it('R7 shows no edit control without help.edit', async () => {
    renderAt('/app/help/workflow');
    await screen.findByRole('heading', { level: 1, name: 'Workflow' });
    for (const name of ['Edit', 'Delete', 'Add section', 'Edit topic', 'Move up'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('R7 a help.edit holder edits a section in HTML mode and saves it', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    help.updateHelpSection.mockResolvedValue(WORKFLOW.sections[1]);
    renderAt('/app/help/workflow');
    await screen.findByRole('heading', { level: 2, name: 'Contest' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'HTML' }));
    const html = screen.getByLabelText('Section HTML');
    expect(html).toHaveValue('<p>See <a href="/app/help/faq">the FAQ</a>.</p>');
    await userEvent.clear(html);
    await userEvent.type(html, '<p>New text</p>');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(help.updateHelpSection).toHaveBeenCalledWith(id(3), {
      title: 'Contest',
      bodyHtml: '<p>New text</p>',
    });
  });

  it('R7 moving a section down sends its new position', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    help.updateHelpSection.mockResolvedValue(WORKFLOW.sections[0]);
    renderAt('/app/help/workflow');
    await screen.findByRole('heading', { level: 2, name: 'Contest' });
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toBeDisabled();
    await userEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0] as HTMLElement);
    expect(help.updateHelpSection).toHaveBeenCalledWith(id(2), { position: 1 });
  });

  it('R7 deleting a section asks for confirmation first', async () => {
    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    help.deleteHelpSection.mockResolvedValue(undefined);
    renderAt('/app/help/workflow');
    await screen.findByRole('heading', { level: 2, name: 'Contest' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1] as HTMLElement);
    expect(help.deleteHelpSection).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete section' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(help.deleteHelpSection).toHaveBeenCalledWith(id(3));
  });
});
