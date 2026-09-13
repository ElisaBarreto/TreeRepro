import { createFileRoute } from '@tanstack/react-router';
import { NoPermission } from '../../../components/shell/NoPermission.tsx';
import { hasPermission, useMe } from '../../../lib/session.ts';
import { ImportPage } from '../../../pages/dataset/ImportPage.tsx';

function ImportRoute() {
  const { id } = Route.useParams();
  if (!hasPermission(useMe(), 'imports.read')) return <NoPermission />;
  return <ImportPage id={id} />;
}

/**
 * Gated by `imports.read` on the client side only; the API decides (RFC-13 R3).
 * @rfc RFC-13 R2, R3
 * @rfc RFC-64 R11
 */
export const Route = createFileRoute('/app/imports/$id')({ component: ImportRoute });
