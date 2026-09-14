import type { ErrorDetail } from '@treerepro/contracts';

/**
 * @rfc RFC-13 R1
 * @rfc RFC-11 R3
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ErrorDetail[],
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: unknown;
  signal?: AbortSignal;
}

/**
 * The only place in the web app that calls fetch. Same origin, cookies included,
 * every failure surfaces as ApiError.
 * @rfc RFC-13 R1
 * @rfc RFC-11 R2-R3
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (!path.startsWith('/')) throw new Error('apiFetch: path must start with /');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.json !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      credentials: 'include',
      signal: options.signal,
    });
  } catch (cause) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server', undefined, cause);
  }

  if (response.status === 204) return undefined as T;
  if (response.ok) return (await response.json()) as T;

  const body: unknown = await response.json().catch(() => null);
  // The envelope is read structurally: this module sits on main.tsx's synchronous
  // import path, so reading it without a schema keeps the entry bundle lean;
  // all schemas in @treerepro/contracts configure zod with jitless: true
  // structurally upon import (RFC-02 R5, RFC-13 R5, issue #63).
  const parsedError = parseErrorEnvelope(body);
  if (parsedError) {
    throw new ApiError(response.status, parsedError.code, parsedError.message, parsedError.details);
  }
  throw new ApiError(
    response.status,
    'UNKNOWN_ERROR',
    `Request failed with status ${response.status}`,
  );
}

function isErrorDetail(value: unknown): value is ErrorDetail {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).path === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

/** @rfc RFC-11 R3 */
function parseErrorEnvelope(
  body: unknown,
): { code: string; message: string; details?: ErrorDetail[] } | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const error = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, message, details } = error as Record<string, unknown>;
  if (typeof code !== 'string' || typeof message !== 'string') return undefined;
  if (details !== undefined && !(Array.isArray(details) && details.every(isErrorDetail))) {
    return undefined;
  }
  return { code, message, details: details as ErrorDetail[] | undefined };
}
