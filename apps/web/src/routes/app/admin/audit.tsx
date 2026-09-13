import { createFileRoute } from '@tanstack/react-router';
import { AuditPage } from '../../../pages/admin/AuditPage.tsx';

/**
 * Gated by the `/app/admin` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-51 R1
 */
export const Route = createFileRoute('/app/admin/audit')({ component: AuditPage });
