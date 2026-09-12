import { createRootRoute, Outlet } from '@tanstack/react-router';

/** @rfc RFC-10 R3 */
export const Route = createRootRoute({
  component: () => <Outlet />,
});
