import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '../pages/HomePage.tsx';

/** @rfc RFC-10 R3 */
export const Route = createFileRoute('/')({
  component: HomePage,
});
