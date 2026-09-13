import { createFileRoute } from '@tanstack/react-router';
import { UserPage } from '../../../../pages/admin/UserPage.tsx';

function UserRoute() {
  const { id } = Route.useParams();
  return <UserPage key={id} id={id} />;
}

/**
 * Gated by the `/app/admin` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-50 R4
 */
export const Route = createFileRoute('/app/admin/users/$id')({ component: UserRoute });
