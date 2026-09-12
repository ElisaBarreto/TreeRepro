import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '../pages/HomePage.tsx';

/** @rfc RFC-13 R2 */
export const Route = createFileRoute('/')({
  component: HomePage,
});
