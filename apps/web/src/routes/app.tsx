import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/shell/AppShell.tsx';
import { meQueryOptions } from '../lib/session.ts';

/** @rfc RFC-13 R2 */
export const Route = createFileRoute('/app')({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions);
    } catch {
      throw redirect({ to: '/' });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
