import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../../../components/ui/index.ts';

/**
 * Placeholder so the species list can link here; plan 06 task 14 replaces it
 * with the species page (RFC-60 R7).
 * @rfc RFC-13 R2
 */
export const Route = createFileRoute('/app/species/$id')({
  component: () => <PageHeader title="Species" />,
});
