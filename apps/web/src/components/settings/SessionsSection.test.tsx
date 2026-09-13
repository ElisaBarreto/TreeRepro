import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { SessionsSection } from './SessionsSection.tsx';

const me = vi.hoisted(() => ({ listSessions: vi.fn(), revokeSession: vi.fn() }));
const auth = vi.hoisted(() => ({ logoutAll: vi.fn(), fetchMe: vi.fn() }));
vi.mock('../../api/me.ts', () => me);
vi.mock('../../api/auth.ts', () => auth);

const SESSIONS = [
  {
    id: 'a'.repeat(64),
    createdAt: '2026-09-12T10:00:00.000Z',
    lastSeenAt: '2026-09-13T10:00:00.000Z',
    ip: '203.0.113.1',
    userAgent: 'Firefox on macOS',
    current: true,
  },
  {
    id: 'b'.repeat(64),
    createdAt: '2026-09-11T10:00:00.000Z',
    lastSeenAt: '2026-09-12T09:00:00.000Z',
    ip: '203.0.113.2',
    userAgent: 'Safari on iPhone',
    current: false,
  },
];

beforeEach(() => {
  me.listSessions.mockReset();
  me.revokeSession.mockReset();
  auth.logoutAll.mockReset();
});

describe('RFC-22 R11 SessionsSection', () => {
  it('lists sessions, marks this device, revokes another one, and signs out everywhere', async () => {
    me.listSessions
      .mockResolvedValueOnce(SESSIONS)
      .mockResolvedValueOnce([SESSIONS[0]])
      .mockResolvedValue([SESSIONS[0]]);
    me.revokeSession.mockResolvedValue(undefined);
    auth.logoutAll.mockResolvedValue(undefined);
    renderWithProviders(<SessionsSection />, { me: ME });
    expect(await screen.findByText('Safari on iPhone')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    // Row buttons are named after their device; "Sign out everywhere" keeps its exact name.
    const buttons = screen.getAllByRole('button', { name: /^Sign out (?!everywhere$).+/ });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Sign out Safari on iPhone']);
    expect(buttons[0]).toHaveTextContent('Sign out');
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeInTheDocument();
    await userEvent.click(buttons[0] as HTMLElement);
    await waitFor(() => expect(me.revokeSession).toHaveBeenCalledWith('b'.repeat(64)));
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(auth.logoutAll).toHaveBeenCalledTimes(1));
  });

  it('shows an empty state when the list is empty', async () => {
    me.listSessions.mockResolvedValue([]);
    renderWithProviders(<SessionsSection />, { me: ME });
    expect(await screen.findByText('No active sessions.')).toBeInTheDocument();
  });
});
