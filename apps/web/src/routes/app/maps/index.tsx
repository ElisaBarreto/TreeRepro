import { createFileRoute } from '@tanstack/react-router';
import { MapsPage } from '../../../pages/maps/MapsPage.tsx';

/** @rfc RFC-76 R6 */
export const Route = createFileRoute('/app/maps/')({
  component: MapsPage,
});
