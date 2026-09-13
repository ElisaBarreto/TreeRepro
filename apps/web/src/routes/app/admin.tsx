import { createFileRoute, Outlet } from '@tanstack/react-router';
import { NoPermission } from '../../components/shell/NoPermission.tsx';
import { hasPermission, useMe } from '../../lib/session.ts';

function AdminLayout() {
  if (!hasPermission(useMe(), 'admin.access')) return <NoPermission />;
  return <Outlet />;
}

/**
 * One gate for every `/app/admin/*` page: `admin.access` on the client side
 * only; every route's own permission is checked again by the API (RFC-32).
 * @rfc RFC-13 R2, R3
 * @rfc RFC-30 R4
 */
export const Route = createFileRoute('/app/admin')({ component: AdminLayout });
