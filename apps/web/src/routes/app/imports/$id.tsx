import { createFileRoute } from '@tanstack/react-router';
import { ImportPage } from '../../../pages/dataset/ImportPage.tsx';

function ImportRoute() {
  const { id } = Route.useParams();
  return <ImportPage key={id} id={id} />;
}

/**
 * Gated by the `/app/imports` layout route.
 * @rfc RFC-13 R2
 * @rfc RFC-64 R11
 */
export const Route = createFileRoute('/app/imports/$id')({ component: ImportRoute });
