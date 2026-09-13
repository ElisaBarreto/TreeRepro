import { screen, within } from '@testing-library/react';
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
      search,
      ...rest
    }: {
      to: string;
      children: React.ReactNode;
      activeOptions?: unknown;
      search?: Record<string, unknown>;
    }) => {
      const qs = search
        ? `?${Object.entries(search)
            .map(([key, value]) => `${key}=${value}`)
            .join('&')}`
        : '';
      return (
        <a href={`${to}${qs}`} {...rest}>
          {children}
        </a>
      );
    },
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: location.pathname, search: location.search }),
  };
});
const location = vi.hoisted(() => ({
  pathname: '/app',
  search: {} as Record<string, unknown>,
}));
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

  it('shows Taxa under Data with taxa.manage, not with dataset.read alone', () => {
    const reader = renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['dataset.read'] },
    });
    expect(screen.queryByRole('link', { name: 'Taxa' })).not.toBeInTheDocument();
    reader.unmount();

    renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['taxa.manage'] },
    });
    const data = screen.getByRole('navigation', { name: 'Data' });
    expect(within(data).getByRole('link', { name: 'Taxa' })).toHaveAttribute('href', '/app/taxa');
    expect(screen.queryByRole('link', { name: 'Species' })).not.toBeInTheDocument();
  });

  it('RFC-13 R3 shows the Curation group with dataset.read, linking Unresolved taxa to the species search with the toggle on', async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      me: { ...ME, permissions: ['dataset.read'] },
    });
    const nav = screen.getByRole('navigation', { name: 'Curation' });
    expect(within(nav).getByRole('link', { name: 'Pending' })).toHaveAttribute(
      'href',
      '/app/curation/pending',
    );
    expect(within(nav).getByRole('link', { name: 'Disputed' })).toHaveAttribute(
      'href',
      '/app/curation/disputed',
    );
    expect(within(nav).getByRole('link', { name: 'Unresolved taxa' })).toHaveAttribute(
      'href',
      '/app/species?unresolved=true',
    );
  });

  it('hides the Curation group without dataset.read', () => {
    renderWithProviders(<AppShell>content</AppShell>, { me: ME });
    expect(screen.queryByRole('navigation', { name: 'Curation' })).not.toBeInTheDocument();
  });
});

describe('RFC-13 R3 AppShell chrome', () => {
  it('shows the emblem, the wordmark and the user name and email', () => {
    renderWithProviders(<AppShell>child</AppShell>, { me: ME });
    expect(screen.getByRole('img', { name: /TreeRepro/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /TreeRepro/ })).toHaveAttribute('href', '/app');
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.org')).toBeInTheDocument();
  });

  it('groups entries: Data appears only with a dataset entry, Admin only with admin.access', () => {
    const { unmount } = renderWithProviders(<AppShell>child</AppShell>, { me: ME });
    expect(screen.queryByText('Data')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<AppShell>child</AppShell>, { me: ADMIN_ME });
    expect(screen.getByText('Data')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Data' })).toContainElement(
      screen.getByRole('link', { name: 'Species' }),
    );
    expect(screen.getByRole('navigation', { name: 'Admin' })).toContainElement(
      screen.getByRole('link', { name: 'Users' }),
    );
  });

  it('marks the current entry and names it in the breadcrumb', () => {
    location.pathname = '/app/species/018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';
    renderWithProviders(<AppShell>child</AppShell>, { me: ADMIN_ME });
    expect(screen.getByRole('link', { name: 'Species' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Workspace' })).not.toHaveAttribute('aria-current');
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumb).toHaveTextContent('Data');
    expect(crumb).toHaveTextContent('Species');
    location.pathname = '/app';
  });

  it('marks Unresolved taxa current on /app/species?unresolved=true and Species without the search', () => {
    location.pathname = '/app/species';
    location.search = { unresolved: true };
    const { unmount } = renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['dataset.read'] },
    });
    expect(screen.getByRole('link', { name: 'Unresolved taxa' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Species' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Unresolved taxa',
    );
    unmount();

    location.search = {};
    renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['dataset.read'] },
    });
    expect(screen.getByRole('link', { name: 'Species' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Unresolved taxa' })).not.toHaveAttribute(
      'aria-current',
    );
    location.pathname = '/app';
  });

  it('the Workspace entry is current only on /app itself', () => {
    location.pathname = '/app/settings';
    renderWithProviders(<AppShell>child</AppShell>, { me: ME });
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Workspace' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Settings');
    location.pathname = '/app';
  });
});
