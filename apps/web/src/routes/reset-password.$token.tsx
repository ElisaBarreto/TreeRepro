import { createFileRoute } from '@tanstack/react-router';
import { ResetPasswordPage } from '../pages/ResetPasswordPage.tsx';

/** @rfc RFC-13 R2 */
export const Route = createFileRoute('/reset-password/$token')({ component: ResetPassword });

function ResetPassword() {
  const { token } = Route.useParams();
  return <ResetPasswordPage token={token} />;
}
