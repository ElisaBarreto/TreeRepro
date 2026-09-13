import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_ME, ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { AppShell } from './AppShell.tsx';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      activeOptions: _activeOptions,
      ...rest
    }: {
      to: string;
      children: React.ReactNode;
      activeOptions?: unknown;
    }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
  };
});
const auth = vi.hoisted(() => ({ logout: vi.fn(), fetchMe: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);

describe('RFC-13 R3 AppShell navigation', () => {
  it('shows Workspace and Settings to everyone, Admin only with admin.access, and the user name', () => {
    const { unmount } = renderWithProviders(<AppShell>child</AppShell>, { me: ME });
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/app/settings');
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
    unmount();
    renderWithProviders(<AppShell>child</AppShell>, { me: ADMIN_ME });
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/app/admin/users');
    expect(screen.getByRole('link', { name: 'Roles' })).toHaveAttribute('href', '/app/admin/roles');
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/app/admin/audit');
  });
});
