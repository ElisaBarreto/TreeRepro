import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { logout } from '../../api/auth.ts';
import { forgetSession, hasPermission, useMe } from '../../lib/session.ts';
import { Alert, Button, Emblem, Icon } from '../ui/index.ts';
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
}: {
  name: string;
  heading: string | null;
  entries: NavEntry[];
  current: NavEntry | undefined;
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
        >
          <Icon name={e.icon} />
          <span>{e.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * Dark sidebar (emblem, grouped entries), light content under a top bar
 * (breadcrumb, user, sign-out). Entries render by permission; the Admin
 * group needs admin.access on top of the entries' own permissions. The
 * current entry is the one `currentEntry` picks for the pathname.
 * @rfc RFC-13 R2, R3, R4
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
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
  const current = currentEntry(pathname);
  const crumbGroup = current?.section
    ? NAV_SECTIONS.find((s) => s.key === current.section)?.label
    : null;

  return (
    <div className="flex min-h-screen bg-mist-50 text-canopy-950">
      <aside className="flex w-[264px] shrink-0 flex-col gap-7 bg-canopy-900 px-4 py-6 text-mist-100">
        <Link
          to="/app"
          className="flex items-center gap-3 rounded-[10px] px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
        >
          <Emblem size={40} />
          <span className="flex flex-col">
            <span className="font-display text-card font-bold tracking-[-0.01em] text-white">
              TreeRepro
            </span>
            <span className="text-label font-semibold uppercase tracking-[0.14em] text-mist-400">
              Workspace
            </span>
          </span>
        </Link>
        {groups.map((g) => (
          <NavGroup
            key={g.name}
            name={g.name}
            heading={g.heading}
            entries={g.entries}
            current={current}
          />
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-canopy-700/10 bg-white px-10">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-cell text-mist-500">
            {crumbGroup ? (
              <>
                <span>{crumbGroup}</span>
                <Icon name="chevronRight" size={16} className="text-mist-300" />
              </>
            ) : null}
            <span className="font-semibold text-canopy-900">{current?.label ?? 'Workspace'}</span>
          </nav>
          <div className="flex items-center gap-4">
            {signOut.isError ? <Alert tone="error">Could not sign out. Try again.</Alert> : null}
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="inline-flex size-9 items-center justify-center rounded-full bg-canopy-200 font-display text-label font-bold text-canopy-900"
              >
                {initials(me.user.name)}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-cell font-semibold text-canopy-950">{me.user.name}</span>
                <span className="text-label text-mist-500">{me.user.email}</span>
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              pending={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              <Icon name="logout" size={18} />
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 px-10 py-8">{children}</main>
      </div>
    </div>
  );
}
