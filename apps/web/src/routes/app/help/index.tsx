import { createFileRoute } from '@tanstack/react-router';
import { HelpIndexPage } from '../../../pages/help/HelpIndexPage.tsx';

/**
 * @rfc RFC-13 R2
 * @rfc RFC-73 R1
 */
export const Route = createFileRoute('/app/help/')({ component: HelpIndexPage });
