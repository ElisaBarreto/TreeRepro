import { createFileRoute } from '@tanstack/react-router';
import { ImportsPage } from '../../../pages/dataset/ImportsPage.tsx';

/**
 * Gated by the `/app/imports` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-64 R11
 */
export const Route = createFileRoute('/app/imports/')({ component: ImportsPage });
