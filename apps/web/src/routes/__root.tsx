import { createRootRoute, Outlet } from '@tanstack/react-router';

/** @rfc RFC-13 R2 */
export const Route = createRootRoute({
  component: () => <Outlet />,
});
