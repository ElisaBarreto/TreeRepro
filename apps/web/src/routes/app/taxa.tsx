import { createFileRoute } from '@tanstack/react-router';
import { TaxaPage } from '../../pages/catalog/TaxaPage.tsx';

/**
 * @rfc RFC-13 R2, R3
 * @rfc RFC-60 R9
 */
export const Route = createFileRoute('/app/taxa')({ component: TaxaPage });
