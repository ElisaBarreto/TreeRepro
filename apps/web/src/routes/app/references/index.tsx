import { createFileRoute } from '@tanstack/react-router';
import { ReferencesPage } from '../../../pages/dataset/ReferencesPage.tsx';

/**
 * @rfc RFC-13 R2
 * @rfc RFC-61 R4
 */
export const Route = createFileRoute('/app/references/')({ component: ReferencesPage });
