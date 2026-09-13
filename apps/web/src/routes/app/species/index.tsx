import { createFileRoute } from '@tanstack/react-router';
import { SpeciesSearchPage } from '../../../pages/dataset/SpeciesSearchPage.tsx';

/**
 * @rfc RFC-13 R2
 * @rfc RFC-60 R6
 */
export const Route = createFileRoute('/app/species/')({ component: SpeciesSearchPage });
