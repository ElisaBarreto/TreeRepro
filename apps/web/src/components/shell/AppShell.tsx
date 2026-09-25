import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
import { logout } from '../../api/auth.ts';
import { forgetSession, hasPermission, useMe } from '../../lib/session.ts';
import { Alert, Button, Drawer, Emblem, Icon } from '../ui/index.ts';
import { BreadcrumbProvider, type Crumb, useCrumbs } from './Breadcrumb.tsx';
import { currentEntry, NAV_ENTRIES, NAV_SECTIONS, type NavEntry } from './nav.ts';

const LINK =
  'flex h-11 items-center gap-3 rounded-[10px] px-3 text-body font-medium text-mist-200 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500 aria-[current=page]:bg-white/10 aria-[current=page]:font-semibold aria-[current=page]:text-white [&[aria-current=page]>svg]:text-pollen-400';

// Not exported: no @rfc tag needed (RFC-00 R6 applies to exports only).
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

// `aria-current` comes from `currentEntry`, not from the router: with exact
// matching the router never marks `/app` active under `/app/species`, so the
// two agree wherever both apply and the prop below is the one that shows.
// The comparison is by entry identity, not by `to`: two entries may share a
// path and differ only in search params (Species and Unresolved taxa).
function NavGroup({
  name,
  heading,
  entries,
  current,
  onNavigate,
}: {
  name: string;
  heading: string | null;
  entries: NavEntry[];
  current: NavEntry | undefined;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label={name} className="flex flex-col gap-1">
      {heading ? (
        <p className="mb-1 px-3 text-label font-bold uppercase tracking-[0.14em] text-mist-400">
          {heading}
        </p>
      ) : null}
      {entries.map((e) => (
        <Link
          key={e.label}
          to={e.to}
          search={e.search}
          activeOptions={{ exact: true }}
          aria-current={current === e ? 'page' : undefined}
          className={LINK}
          onClick={onNavigate}
        >
          <Icon name={e.icon} />
          <span>{e.label}</span>
        </Link>
      ))}
    </nav>
  );
}

const CRUMB_LINK =
  'text-mist-500 transition-colors hover:text-canopy-700 hover:underline rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';

// `Link` sets `aria-current="page"` on its own — unconditionally, after
// whatever prop is passed — whenever it decides its target is "active", and
// without `activeOptions.exact` that decision is a path-segment prefix
// match. A non-last breadcrumb segment's `to` is either the current entry's
// own route (`crumbGroup`/entry, once any crumb is registered) or a
// registered crumb's own link, and either would prefix-match the URL of the
// page that registered it (e.g. `/app/species` under `/app/species/$id`),
// so without `exact` the router would mark it current too.
//
// `exact: true` fixes it by changing the decision instead of fighting the
// output: a non-last segment only gets a `to` when `hasCrumbs` is true
// below, which — for every page that registers a crumb today (species,
// references, plots; all `/app/<section>/$id` routes) — only happens on a
// route one segment deeper than that `to`, so the pathnames can never be
// equal and the link is never "active". (An earlier version of this fixed
// it after the fact instead, with a ref and a `useLayoutEffect` stripping
// the attribute every render — correct, but it fought the router silently
// on every render instead of just telling it the truth once.)
//
// `includeSearch: false`: the default (`true`) would also compare search,
// and in practice a detail page's own search almost never matches this
// link's empty one — but that would make the check pass for the wrong
// reason (an incidental search mismatch) instead of the real one (the
// pathnames differ), so search is explicitly left out of the decision here.
const CRUMB_ACTIVE_OPTIONS = { exact: true, includeSearch: false } as const;

// Renders `Group › Entry › crumbs…`: `crumbGroup` and the current entry's
// label link (to the current entry's own route) once a page has registered
// trailing crumbs through `useBreadcrumb`; whichever segment ends up last —
// the entry when there are no registered crumbs, else the last registered
// crumb — renders as text with `aria-current="page"`. Must render below
// `BreadcrumbProvider` to read `useCrumbs`.
function BreadcrumbTrail({
  crumbGroup,
  current,
}: {
  crumbGroup: string | null | undefined;
  current: NavEntry | undefined;
}) {
  const crumbs = useCrumbs();
  const hasCrumbs = crumbs.length > 0;
  const linkTarget = hasCrumbs ? { to: current?.to, search: current?.search } : {};
  const segments: (Crumb & { key: string })[] = [];
  if (crumbGroup) segments.push({ key: 'group', label: crumbGroup, ...linkTarget });
  segments.push({ key: 'entry', label: current?.label ?? 'Workspace', ...linkTarget });
  crumbs.forEach((crumb, index) => {
    segments.push({ ...crumb, key: `crumb-${index}` });
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2 text-cell text-mist-500"
    >
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <Fragment key={segment.key}>
            {isLast ? (
              <span aria-current="page" className="truncate font-semibold text-canopy-900">
                {segment.label}
              </span>
            ) : segment.to ? (
              <Link
                to={segment.to}
                search={segment.search}
                activeOptions={CRUMB_ACTIVE_OPTIONS}
                className={`truncate ${CRUMB_LINK}`}
              >
                {segment.label}
              </Link>
            ) : (
              <span className="truncate">{segment.label}</span>
            )}
            {!isLast ? <Icon name="chevronRight" size={16} className="text-mist-300" /> : null}
          </Fragment>
        );
      })}
    </nav>
  );
}

/**
 * Dark sidebar (emblem, grouped entries), light content under a top bar
 * (breadcrumb, user, sign-out). Entries render by permission; the Admin
 * group needs admin.access on top of the entries' own permissions. The
 * current entry is the one `currentEntry` picks for the pathname and search.
 * The breadcrumb is `Group › Entry › crumbs…`, the trailing crumbs coming
 * from pages that call `useBreadcrumb` (RFC-13 R3 amendment, plan 10a).
 * The sidebar emblem carries the view transition name the landing stage
 * shares, so the sign-in reveal ends on it (RFC-13 R7).
 * Below `lg` the sidebar is hidden and a menu button in the top bar opens
 * the same entries in a modal drawer from the left, which closes when an
 * entry is followed; the top bar drops the user's name and email and the
 * Sign out label, and the padding tightens (RFC-13 R12).
 * @rfc RFC-13 R2, R3, R4, R7, R12
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pathname, search } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // Tailwind's `lg` (64rem): once the sidebar shows, the menu drawer closes.
  // jsdom has no matchMedia, hence the guard.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const lg = window.matchMedia('(min-width: 64rem)');
    const onChange = (event: { matches: boolean }) => {
      if (event.matches) setMenuOpen(false);
    };
    lg.addEventListener('change', onChange);
    return () => lg.removeEventListener('change', onChange);
  }, []);
  const signOut = useMutation({
    mutationFn: logout,
    // A failed logout (5xx/429) leaves the session in place — no navigation,
    // no removal — instead of forgetting a session the API still holds. A
    // session-loss failure (401 AUTH_UNAUTHENTICATED) is handled globally by
    // the MutationCache handler in main.tsx.
    onSuccess: async () => {
      await navigate({ to: '/' });
      forgetSession(queryClient);
    },
  });
  const visible = NAV_ENTRIES.filter((e) => !e.permission || hasPermission(me, e.permission));
  const groups = [
    { name: 'Main', heading: null, entries: visible.filter((e) => !e.section) },
    ...NAV_SECTIONS.map((s) => ({
      name: s.label ?? 'Account',
      heading: s.label,
      entries:
        s.key === 'admin' && !hasPermission(me, 'admin.access')
          ? []
          : visible.filter((e) => e.section === s.key),
    })),
  ].filter((g) => g.entries.length > 0);
  const current = currentEntry(pathname, search);
  const crumbGroup = current?.section
    ? NAV_SECTIONS.find((s) => s.key === current.section)?.label
    : null;
  const navGroups = (onNavigate?: () => void) =>
    groups.map((g) => (
      <NavGroup
        key={g.name}
        name={g.name}
        heading={g.heading}
        entries={g.entries}
        current={current}
        onNavigate={onNavigate}
      />
    ));

  return (
    <BreadcrumbProvider>
      <div className="flex min-h-screen bg-mist-50 text-canopy-950">
        <aside className="hidden w-[264px] shrink-0 flex-col gap-7 bg-canopy-900 px-4 py-6 text-mist-100 lg:flex">
          <Link
            to="/app"
            className="flex items-center gap-3 rounded-[10px] px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
          >
            <Emblem size={40} className="[view-transition-name:tr-emblem]" />
            <span className="flex flex-col">
              <span className="font-display text-card font-bold tracking-[-0.01em] text-white">
                TreeRepro
              </span>
              <span className="text-label font-semibold uppercase tracking-[0.14em] text-mist-400">
                Workspace
              </span>
            </span>
          </Link>
          {navGroups()}
        </aside>
        <Drawer open={menuOpen} title="Menu" side="left" onClose={() => setMenuOpen(false)}>
          <div className="flex flex-col gap-7">{navGroups(() => setMenuOpen(false))}</div>
        </Drawer>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between gap-4 border-b border-canopy-700/10 bg-white px-4 sm:px-6 lg:px-10">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                aria-label="Open menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
                className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-canopy-900 transition-colors hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500 lg:hidden"
              >
                <Icon name="menu" />
              </button>
              <BreadcrumbTrail crumbGroup={crumbGroup} current={current} />
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {signOut.isError ? <Alert tone="error">Could not sign out. Try again.</Alert> : null}
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="inline-flex size-9 items-center justify-center rounded-full bg-canopy-200 font-display text-label font-bold text-canopy-900"
                >
                  {initials(me.user.name)}
                </span>
                <span className="hidden flex-col leading-tight sm:flex">
                  <span className="text-cell font-semibold text-canopy-950">{me.user.name}</span>
                  <span className="text-label text-mist-500">{me.user.email}</span>
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                // 44px touch target on phones, where the label is hidden.
                className="max-sm:size-11 max-sm:px-0"
                pending={signOut.isPending}
                onClick={() => signOut.mutate()}
                aria-label="Sign out"
              >
                <Icon name="logout" size={18} />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </header>
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
