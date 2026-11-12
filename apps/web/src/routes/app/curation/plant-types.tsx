import { createFileRoute } from '@tanstack/react-router';
import { PlantTypesPage } from '../../../pages/curation/PlantTypesPage.tsx';

/**
 * @rfc RFC-13 R2
 * @rfc RFC-65 R20
 */
export const Route = createFileRoute('/app/curation/plant-types')({ component: PlantTypesPage });
