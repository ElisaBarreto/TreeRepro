import { createFileRoute } from '@tanstack/react-router';
import { SpeciesPage } from '../../../pages/dataset/SpeciesPage.tsx';

/**
 * @rfc RFC-13 R2
 * @rfc RFC-60 R7
 */
export const Route = createFileRoute('/app/species/$id')({
  component: () => <SpeciesPage id={Route.useParams().id} />,
});
