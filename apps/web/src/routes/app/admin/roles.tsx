import { createFileRoute } from '@tanstack/react-router';
import { RolesPage } from '../../../pages/admin/RolesPage.tsx';

/**
 * Gated by the `/app/admin` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-50 R10
 */
export const Route = createFileRoute('/app/admin/roles')({ component: RolesPage });
