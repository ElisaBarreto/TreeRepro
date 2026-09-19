import { createFileRoute } from '@tanstack/react-router';
import { HelpTopicPage } from '../../../pages/help/HelpTopicPage.tsx';

// The slug is never trusted to name a topic: an unknown one renders the
// index (RFC-73 R1), so there is nothing to validate here.
function HelpTopicRoute() {
  const { topic } = Route.useParams();
  return <HelpTopicPage slug={topic} />;
}

/**
 * @rfc RFC-13 R2
 * @rfc RFC-73 R1, R2
 */
export const Route = createFileRoute('/app/help/$topic')({ component: HelpTopicRoute });
