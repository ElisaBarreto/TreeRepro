import { fireEvent, screen, within } from '@testing-library/react';
import { forwardRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_ME, ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { AppShell } from './AppShell.tsx';
import { useBreadcrumb } from './Breadcrumb.tsx';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    // Forwards its ref and, like the real `Link`, applies `data-status`/
    // `aria-current="page"` on its own — unconditionally overriding any
    // prop passed in — whenever the target is active: an exact pathname
    // match, or (without `activeOptions.exact`) a path-segment prefix
    // match. That prefix rule is what makes a breadcrumb link to
    // `/app/species` "active" while on `/app/species/$id`; the mock has to
    // reproduce it, or a test here could never catch that defect.
    Link: forwardRef<
      HTMLAnchorElement,
      {
        to: string;
        children: React.ReactNode;
        activeOptions?: { exact?: boolean; includeSearch?: boolean };
        search?: Record<string, unknown>;
      }
    >(({ to, children, activeOptions, search, ...rest }, ref) => {
      const qs = search
        ? `?${Object.entries(search)
            .map(([key, value]) => `${key}=${value}`)
            .join('&')}`
        : '';
      // `exact` requires the search to match exactly (both empty counts as a
      // match); otherwise the link's own search just needs to be a subset of
      // the current one — same rule the real router applies by default
      // (`includeSearch` defaults to true), and needed here so a link with
      // no `search` of its own (like the Species entry) is not wrongly
      // marked active just because the current location happens to carry
      // one. `includeSearch: false` (the breadcrumb's crumb links) skips
      // this comparison entirely, same as the real router.
      const next = search ?? {};
      const current = location.search ?? {};
      const searchOk =
        activeOptions?.includeSearch === false
          ? true
          : activeOptions?.exact
            ? Object.keys(next).length === Object.keys(current).length &&
              Object.entries(next).every(([key, value]) => current[key] === value)
            : Object.entries(next).every(([key, value]) => current[key] === value);
      const isActive =
        (activeOptions?.exact
          ? location.pathname === to
          : location.pathname === to || location.pathname.startsWith(`${to}/`)) && searchOk;
      return (
        <a
          ref={ref}
          href={`${to}${qs}`}
          {...rest}
          {...(isActive ? { 'data-status': 'active', 'aria-current': 'page' } : {})}
        >
          {children}
        </a>
      );
    }),
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
    expect(screen.getByRole('link', { name: 'Plots' })).toHaveAttribute('href', '/app/admin/plots');
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/app/admin/audit');
  });

  it('needs admin.access AND the entry permission — neither alone is enough', () => {
    const { unmount } = renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['admin.access'] },
    });
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plots' })).not.toBeInTheDocument();
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

  it('RFC-71 shows My contributions under Data with dataset.read', () => {
    const { unmount } = renderWithProviders(<AppShell>child</AppShell>, { me: ME });
    expect(screen.queryByRole('link', { name: 'My contributions' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<AppShell>child</AppShell>, {
      me: { ...ME, permissions: ['dataset.read'] },
    });
    const data = screen.getByRole('navigation', { name: 'Data' });
    expect(within(data).getByRole('link', { name: 'My contributions' })).toHaveAttribute(
      'href',
      '/app/contributions',
    );
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

  it('RFC-31 R11 shows the Curation group with records.review, linking Unresolved taxa to the species search with the toggle on', async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      me: { ...ME, permissions: ['dataset.read', 'records.review'] },
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

  it('RFC-75 R3 shows Proposals under Curation with taxa.manage, and never without it', () => {
    const { unmount } = renderWithProviders(<AppShell>content</AppShell>, {
      me: { ...ME, permissions: ['dataset.read', 'records.review', 'taxa.propose'] },
    });
    // The Curation group is on screen (records.review renders Pending), so
    // this negative assertion is about the entry, not about an empty sidebar.
    expect(screen.getByRole('navigation', { name: 'Curation' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Proposals' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<AppShell>content</AppShell>, {
      me: { ...ME, permissions: ['dataset.read', 'taxa.manage'] },
    });
    const curation = screen.getByRole('navigation', { name: 'Curation' });
    expect(within(curation).getByRole('link', { name: 'Proposals' })).toHaveAttribute(
      'href',
      '/app/curation/proposals',
    );
  });

  it('RFC-31 R11 a contributor session (dataset.read, records.create, records.annotate) renders no Curation group', () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      me: { ...ME, permissions: ['dataset.read', 'records.create', 'records.annotate'] },
    });
    expect(screen.queryByRole('navigation', { name: 'Curation' })).not.toBeInTheDocument();
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
      me: { ...ME, permissions: ['dataset.read', 'records.review'] },
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
      me: { ...ME, permissions: ['dataset.read', 'records.review'] },
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

describe('RFC-13 R3 hierarchical breadcrumb', () => {
  function SpeciesCrumbRegistrar() {
    useBreadcrumb([{ label: 'Anathallis funerea' }]);
    return null;
  }
  // A page unmounts its crumb-registering piece itself (e.g. navigating
  // away); this stands in for that, toggled from inside the tree so the
  // QueryClientProvider `renderWithProviders` wraps around stays mounted.
  function SpeciesCrumbToggle() {
    const [show, setShow] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setShow(false)}>
          leave
        </button>
        {show ? <SpeciesCrumbRegistrar /> : null}
      </>
    );
  }

  it('appends a page-registered crumb after Data › Species, the trailing one as text with aria-current, the rest as links', () => {
    location.pathname = '/app/species/018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';
    const { unmount } = renderWithProviders(
      <AppShell>
        <SpeciesCrumbRegistrar />
      </AppShell>,
      { me: ADMIN_ME },
    );
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumb).toHaveTextContent('Data');
    expect(crumb).toHaveTextContent('Species');
    expect(crumb).toHaveTextContent('Anathallis funerea');
    expect(within(crumb).getByRole('link', { name: 'Data' })).toHaveAttribute(
      'href',
      '/app/species',
    );
    expect(within(crumb).getByRole('link', { name: 'Species' })).toHaveAttribute(
      'href',
      '/app/species',
    );
    const last = within(crumb).getByText('Anathallis funerea');
    expect(last).toHaveAttribute('aria-current', 'page');
    expect(last.tagName).not.toBe('A');
    unmount();
    location.pathname = '/app';
  });

  it('marks exactly one element aria-current="page" in the breadcrumb, and it is the last crumb — not the Data/Species links the router also thinks are active', () => {
    // The router's own active-link detection is a path-segment prefix
    // match: `/app/species` prefix-matches the `/app/species/$id` we are on,
    // so both the Data and Species crumb links are "active" by the router's
    // rules even though only the last crumb is the current page.
    location.pathname = '/app/species/018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';
    const { unmount } = renderWithProviders(
      <AppShell>
        <SpeciesCrumbRegistrar />
      </AppShell>,
      { me: ADMIN_ME },
    );
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const current = crumb.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Anathallis funerea');
    unmount();
    location.pathname = '/app';
  });

  it('removes the registered crumb once the registering component unmounts', () => {
    location.pathname = '/app/species/018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';
    const { unmount } = renderWithProviders(
      <AppShell>
        <SpeciesCrumbToggle />
      </AppShell>,
      { me: ADMIN_ME },
    );
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Anathallis funerea',
    );
    fireEvent.click(screen.getByText('leave'));
    const entry = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(entry).not.toHaveTextContent('Anathallis funerea');
    expect(within(entry).queryByRole('link', { name: 'Species' })).not.toBeInTheDocument();
    expect(within(entry).getByText('Species')).toHaveAttribute('aria-current', 'page');
    unmount();
    location.pathname = '/app';
  });
});
