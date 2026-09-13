import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../../../components/ui/index.ts';

/**
 * Placeholder so the record drawer can link to a reference; plan 06 task 15
 * replaces it with the reference page (RFC-61 R4).
 * @rfc RFC-13 R2
 */
export const Route = createFileRoute('/app/references/$id')({
  component: () => <PageHeader title="Reference" />,
});
