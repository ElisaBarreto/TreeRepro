import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client.ts';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('RFC-13 R1 apiFetch', () => {
  it('prefixes /api, sends cookies and a JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: '1' } }));
    const result = await apiFetch<{ data: { id: string } }>('/things', {
      method: 'POST',
      json: { a: 1 },
    });
    expect(result).toEqual({ data: { id: '1' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/things');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('rejects paths that do not start with /', async () => {
    await expect(apiFetch('things')).rejects.toThrow(/must start with \//);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiFetch('/things/1', { method: 'DELETE' })).toBeUndefined();
  });
});

describe('RFC-11 R3 error envelope handling', () => {
  it('turns an error envelope into ApiError with status, code, message and details', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: [{ path: 'age', message: 'Expected number' }],
        },
      }),
    );
    const error = await apiFetch('/things').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.message).toBe('Request validation failed');
    expect(apiError.details).toEqual([{ path: 'age', message: 'Expected number' }]);
  });

  it('maps a non-envelope failure to UNKNOWN_ERROR with the status', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));
    const error = (await apiFetch('/things').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.status).toBe(502);
  });

  it('maps a network failure to NETWORK_ERROR with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = (await apiFetch('/things').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
  });
});
