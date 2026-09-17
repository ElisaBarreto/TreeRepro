import { createFileRoute } from '@tanstack/react-router';
import { PlotPage } from '../../../../pages/admin/PlotPage.tsx';

function PlotRoute() {
  const { id } = Route.useParams();
  return <PlotPage key={id} id={id} />;
}

/**
 * Gated by the `/app/admin` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-67 R3
 */
export const Route = createFileRoute('/app/admin/plots/$id')({ component: PlotRoute });
