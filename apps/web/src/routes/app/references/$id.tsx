import { createFileRoute } from '@tanstack/react-router';
import { ReferencePage } from '../../../pages/dataset/ReferencePage.tsx';

function ReferenceRoute() {
  const { id } = Route.useParams();
  return <ReferencePage key={id} id={id} />;
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-61 R4
 */
export const Route = createFileRoute('/app/references/$id')({ component: ReferenceRoute });
