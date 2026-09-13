import { createFileRoute } from '@tanstack/react-router';
import { NoPermission } from '../../../components/shell/NoPermission.tsx';
import { hasPermission, useMe } from '../../../lib/session.ts';
import { ImportsPage } from '../../../pages/dataset/ImportsPage.tsx';

function ImportsRoute() {
  if (!hasPermission(useMe(), 'imports.read')) return <NoPermission />;
  return <ImportsPage />;
}

/**
 * Gated by `imports.read` on the client side only; the API decides (RFC-13 R3).
 * @rfc RFC-13 R2, R3
 * @rfc RFC-64 R11
 */
export const Route = createFileRoute('/app/imports/')({ component: ImportsRoute });
