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
  // Dynamic: the entry chunk statically imports @treerepro/contracts, which
  // imports zod internals back from the entry (a chunk cycle), so the
  // contracts chunk — every schema — evaluates before the entry's own
  // modules, lib/zod-jitless.ts included; a static import here would trip
  // zod's JIT probe (RFC-13 R5) before the config runs. Guarded: apiFetch's
  // contract is that every failure surfaces as ApiError (isSessionLoss,
  // session.ts, only recognizes ApiError), so a failed chunk load must not
  // reject with a raw module error.
  let parsedError: { code: string; message: string; details?: ErrorDetail[] } | undefined;
  try {
    const { errorEnvelopeSchema } = await import('@treerepro/contracts');
    const parsed = errorEnvelopeSchema.safeParse(body);
    if (parsed.success) parsedError = parsed.data.error;
  } catch {
    // Falls through to the generic ApiError below.
  }
  if (parsedError) {
    throw new ApiError(response.status, parsedError.code, parsedError.message, parsedError.details);
  }
  throw new ApiError(
    response.status,
    'UNKNOWN_ERROR',
    `Request failed with status ${response.status}`,
  );
}
