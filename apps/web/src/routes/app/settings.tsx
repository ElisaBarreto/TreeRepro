import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '../../pages/SettingsPage.tsx';

/** @rfc RFC-13 R2 */
export const Route = createFileRoute('/app/settings')({ component: SettingsPage });
