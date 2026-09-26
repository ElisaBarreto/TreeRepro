import { createFileRoute } from '@tanstack/react-router';
import { TraitMapsPage } from '../../../pages/maps/TraitMapsPage.tsx';

function TraitMapsRoute() {
  const { traitId } = Route.useParams();
  return <TraitMapsPage key={traitId} traitId={traitId} />;
}

/** @rfc RFC-76 R7 */
export const Route = createFileRoute('/app/maps/$traitId')({
  component: TraitMapsRoute,
});
