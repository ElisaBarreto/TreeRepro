import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { logout } from '../../api/auth.ts';
import { forgetSession, hasPermission, useMe } from '../../lib/session.ts';
import { Alert, Button } from '../ui/index.ts';
import { NAV_ENTRIES } from './nav.ts';

const LINK =
  'block rounded-lg px-3 py-2 text-sm text-mist-200 transition-colors hover:bg-white/5 hover:text-white [&.active]:bg-white/10 [&.active]:text-white';

/**
 * Dark sidebar, light content. Entries render by permission; the Admin
 * heading needs admin.access on top of the entries' own permissions.
 * @rfc RFC-13 R2, R3, R4
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const main = visible.filter((e) => !e.section);
  const admin = hasPermission(me, 'admin.access')
    ? visible.filter((e) => e.section === 'admin')
    : [];

  return (
    <div className="flex min-h-screen bg-mist-50 text-canopy-950">
      <aside className="flex w-60 shrink-0 flex-col gap-6 bg-canopy-900 px-4 py-6 text-mist-100">
        <Link
          to="/app"
          className="px-3 font-display text-xs font-semibold uppercase tracking-[0.28em] text-mist-300"
        >
          TreeRepro
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {main.map((e) => (
            <Link key={e.to} to={e.to} activeOptions={{ exact: e.to === '/app' }} className={LINK}>
              {e.label}
            </Link>
          ))}
        </nav>
        {admin.length > 0 ? (
          <nav aria-label="Admin" className="flex flex-col gap-1">
            <p className="px-3 text-xs font-semibold uppercase tracking-wider text-mist-400">
              Admin
            </p>
            {admin.map((e) => (
              <Link key={e.to} to={e.to} className={LINK}>
                {e.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-4 border-b border-canopy-700/10 bg-white px-6">
          {signOut.isError ? <Alert tone="error">Could not sign out. Try again.</Alert> : null}
          <span className="text-sm text-canopy-800">{me.user.name}</span>
          <Button variant="secondary" pending={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign out
          </Button>
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
