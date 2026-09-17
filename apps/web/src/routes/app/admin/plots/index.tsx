import { createFileRoute } from '@tanstack/react-router';
import { PlotsPage } from '../../../../pages/admin/PlotsPage.tsx';

/**
 * Gated by the `/app/admin` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-67 R3
 */
export const Route = createFileRoute('/app/admin/plots/')({ component: PlotsPage });
