import type { BrowserContext } from '@playwright/test';
import { BASE_URL } from './env.ts';

/**
 * Calls the API the way Caddy sees the app: same origin, `context`'s
 * cookies riding along and an explicit `Origin` header (the CSRF guard
 * checks it). Answers the parsed JSON body, or `null` for a 204 or an
 * otherwise empty response.
 */
export async function apiCall<T = unknown>(
  context: BrowserContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const response = await context.request.fetch(BASE_URL + path, {
    method,
    data: body,
    headers: { origin: BASE_URL },
  });
  const text = await response.text();
  const json = (text.length === 0 ? null : JSON.parse(text)) as T;
  return { status: response.status(), json };
}
