import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { RouterContext } from '../lib/session.ts';

/** @rfc RFC-13 R2 */
export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});
