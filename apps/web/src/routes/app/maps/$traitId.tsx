import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '../../../components/ui/index.ts';

// Registers the route so `MapsPage`'s cards (`Link to="/app/maps/$traitId"`)
// resolve under the typed router; the real page (RFC-76 R7) replaces this
// placeholder in the next plan step.
function TraitMapsPlaceholder() {
  return <EmptyState title="Maps for this trait are coming soon." />;
}

/** @rfc RFC-76 R6 */
export const Route = createFileRoute('/app/maps/$traitId')({
  component: TraitMapsPlaceholder,
});
