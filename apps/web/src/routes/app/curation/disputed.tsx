import { createFileRoute } from '@tanstack/react-router';
import { DisputedPage } from '../../../pages/curation/DisputedPage.tsx';

/**
 * @rfc RFC-13 R2
 * @rfc RFC-65 R10
 */
export const Route = createFileRoute('/app/curation/disputed')({ component: DisputedPage });
