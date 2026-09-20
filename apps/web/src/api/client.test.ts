import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { ApiError, apiFetch } from './client.ts';

const thing = z.strictObject({ data: z.strictObject({ id: z.string() }) });

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
    const result = await apiFetch('/things', thing, { method: 'POST', json: { a: 1 } });
    expect(result).toEqual({ data: { id: '1' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/things');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('rejects paths that do not start with /', async () => {
    await expect(apiFetch('things', z.unknown())).rejects.toThrow(/must start with \//);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hands a 204 to the schema as undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiFetch('/things/1', z.undefined(), { method: 'DELETE' })).toBeUndefined();
  });
});

describe('RFC-13 R1 response validation', () => {
  it('returns the body parsed by the schema', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: '1' } }));
    await expect(apiFetch('/things/1', thing)).resolves.toEqual({ data: { id: '1' } });
  });

  it('rejects a body the schema refuses with RESPONSE_INVALID, the status and the failing paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: 1, name: 'Ada' } }));
    const error = (await apiFetch('/things/1', thing).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(200);
    expect(error.code).toBe('RESPONSE_INVALID');
    expect(error.message).toBe('Unexpected response from the server');
    expect(error.details?.map((d) => d.path).sort()).toEqual(['data', 'data.id']);
    expect(error.cause).toBeInstanceOf(ZodError);
  });

  it('rejects a 200 whose body is not JSON with RESPONSE_INVALID', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    const error = (await apiFetch('/things/1', thing).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('RESPONSE_INVALID');
    expect(error.status).toBe(200);
    expect(error.details).toEqual([{ path: '', message: 'Expected a JSON body' }]);
    expect((error.cause as Error).name).toBe('SyntaxError');
  });

  it('rejects a 204 where the schema expects a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const error = (await apiFetch('/things/1', thing).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('RESPONSE_INVALID');
    expect(error.status).toBe(204);
  });

  it('rejects a body where none was expected', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { id: '1' } }));
    const error = (await apiFetch('/things/1', z.undefined(), { method: 'DELETE' }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.code).toBe('RESPONSE_INVALID');
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
    const error = await apiFetch('/things', z.unknown()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.message).toBe('Request validation failed');
    expect(apiError.details).toEqual([{ path: 'age', message: 'Expected number' }]);
  });

  it('maps a non-envelope failure to UNKNOWN_ERROR with the status', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));
    const error = (await apiFetch('/things', z.unknown()).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.status).toBe(502);
  });

  it('surfaces a code outside the catalog verbatim (read structurally, not against the zod enum)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: 'NEW_CODE', message: 'Something new' } }),
    );
    const error = (await apiFetch('/things', z.unknown()).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('NEW_CODE');
    expect(error.message).toBe('Something new');
    expect(error.details).toBeUndefined();
  });

  it('maps a malformed envelope to UNKNOWN_ERROR', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: { code: 1 } }));
    const error = (await apiFetch('/things', z.unknown()).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.status).toBe(400);
  });

  it('carries details through when present', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: [{ path: 'name', message: 'Required' }],
        },
      }),
    );
    const error = (await apiFetch('/things', z.unknown()).catch((e: unknown) => e)) as ApiError;
    expect(error.details).toEqual([{ path: 'name', message: 'Required' }]);
  });

  it('maps a network failure to NETWORK_ERROR with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = (await apiFetch('/things', z.unknown()).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
  });
});
