import { createFileRoute } from '@tanstack/react-router';
import { HealthPage } from '../../../pages/admin/HealthPage.tsx';

/**
 * Gated by the `/app/admin` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-52 R1
 */
export const Route = createFileRoute('/app/admin/health')({ component: HealthPage });
