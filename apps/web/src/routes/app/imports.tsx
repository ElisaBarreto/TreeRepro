import { createFileRoute, Outlet } from '@tanstack/react-router';
import { NoPermission } from '../../components/shell/NoPermission.tsx';
import { hasPermission, useMe } from '../../lib/session.ts';

function ImportsLayout() {
  if (!hasPermission(useMe(), 'imports.read')) return <NoPermission />;
  return <Outlet />;
}

/**
 * One gate for every `/app/imports/*` page: `imports.read` on the client side
 * only; the API decides (RFC-13 R3).
 * @rfc RFC-13 R2, R3
 * @rfc RFC-64 R11
 */
export const Route = createFileRoute('/app/imports')({ component: ImportsLayout });
