import { createFileRoute } from '@tanstack/react-router';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage.tsx';

/** @rfc RFC-13 R2 */
export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage });
