import { createFileRoute } from '@tanstack/react-router';
import { WorkspacePage } from '../../pages/WorkspacePage.tsx';

/** @rfc RFC-13 R2 */
export const Route = createFileRoute('/app/')({ component: WorkspacePage });
