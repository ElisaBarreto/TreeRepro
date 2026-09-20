import { type Dashboard, dashboardSchema, dataEnvelopeSchema } from '@treerepro/contracts';
import { apiFetch } from './client.ts';

/**
 * Query keys of the workspace dashboard. `WorkspacePage` reads the one
 * query built from `mine` and {@link fetchDashboard} — following the shape
 * of `api/contributions.ts`, a plain fetch function and its key rather than
 * a `queryOptions()` object, so mocking `fetchDashboard` in a test reaches
 * the page the same way mocking any other fetcher here does.
 * @rfc RFC-72 R1
 */
export const dashboardKeys = {
  mine: ['dashboard', 'me'] as const,
};

/** @rfc RFC-72 R1 */
export async function fetchDashboard(): Promise<Dashboard> {
  return (await apiFetch('/me/dashboard', dataEnvelopeSchema(dashboardSchema))).data;
}
