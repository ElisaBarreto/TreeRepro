import { createFileRoute } from '@tanstack/react-router';
import { PendingPage } from '../../../pages/curation/PendingPage.tsx';

/**
 * @rfc RFC-13 R2
 * @rfc RFC-65 R8
 */
export const Route = createFileRoute('/app/curation/pending')({ component: PendingPage });
