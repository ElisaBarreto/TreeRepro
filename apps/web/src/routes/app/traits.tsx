import { createFileRoute } from '@tanstack/react-router';
import { TraitsPage } from '../../pages/dataset/TraitsPage.tsx';

/**
 * @rfc RFC-13 R2
 * @rfc RFC-62 R5
 */
export const Route = createFileRoute('/app/traits')({ component: TraitsPage });
