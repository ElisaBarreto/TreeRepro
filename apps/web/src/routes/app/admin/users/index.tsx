import { createFileRoute } from '@tanstack/react-router';
import { UsersPage } from '../../../../pages/admin/UsersPage.tsx';

/**
 * Gated by the `/app/admin` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-50 R2
 */
export const Route = createFileRoute('/app/admin/users/')({ component: UsersPage });
