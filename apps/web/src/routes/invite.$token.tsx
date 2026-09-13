import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { InvitePage } from '../pages/InvitePage.tsx';

/** @rfc RFC-13 R2 */
export const Route = createFileRoute('/invite/$token')({ component: Invite });

function Invite() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  return <InvitePage token={token} onAccepted={() => void navigate({ to: '/app' })} />;
}
