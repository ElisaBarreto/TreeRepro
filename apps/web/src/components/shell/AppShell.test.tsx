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

  it('needs admin.access AND the entry permission — neither alone is enough', () => {
    const { unmount } = renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['admin.access'] },
    });
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<AppShell>child</AppShell>, { me: { ...ME, permissions: ['users.read'] } });
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('shows Species, Traits and References with dataset.read and Imports with imports.read', () => {
    const { unmount } = renderWithProviders(<AppShell>child</AppShell>, { me: ME });
    for (const name of ['Species', 'Traits', 'References', 'Imports']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
    unmount();

    const reader = renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['dataset.read'] },
    });
    expect(screen.getByRole('link', { name: 'Species' })).toHaveAttribute('href', '/app/species');
    expect(screen.getByRole('link', { name: 'Traits' })).toHaveAttribute('href', '/app/traits');
    expect(screen.getByRole('link', { name: 'References' })).toHaveAttribute(
      'href',
      '/app/references',
    );
    expect(screen.queryByRole('link', { name: 'Imports' })).not.toBeInTheDocument();
    reader.unmount();

    renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['imports.read'] },
    });
    expect(screen.getByRole('link', { name: 'Imports' })).toHaveAttribute('href', '/app/imports');
    expect(screen.queryByRole('link', { name: 'Species' })).not.toBeInTheDocument();
  });
});
