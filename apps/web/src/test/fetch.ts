import { afterEach, beforeEach, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();

/**
 * Stubs `globalThis.fetch` with a mock reset before each test and restored
 * after, for the file that calls it.
 * @rfc RFC-01 R2
 */
export function installFetchMock() {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
}

/** Queues one JSON response for the next `fetch` call. @rfc RFC-01 R2 */
export function mockJson(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

/** The most recent `fetch` call. @rfc RFC-01 R2 */
export function lastRequest(): { url: string; init: RequestInit | undefined } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('lastRequest(): fetch was not called');
  const [url, init] = call;
  return { url: String(url), init };
}
