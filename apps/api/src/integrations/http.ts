/**
 * Generic HTTP helper for fixed-host JSON fetches (no arbitrary redirects).
 * @rfc RFC-80 R3, R6
 */

export interface FixedHostFetchOptions {
  url: URL;
  allowedHost: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

export type FixedHostResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number }
  | { ok: false; error: 'timeout' | 'network' | 'redirect' | 'too_large' | 'invalid_json' };

/** @rfc RFC-80 R3, R6 */
export async function fetchJsonFixedHost(o: FixedHostFetchOptions): Promise<FixedHostResult> {
  if (o.url.protocol !== 'https:' || o.url.host !== o.allowedHost) {
    throw new Error(`host ${o.url.host} is not ${o.allowedHost}`);
  }
  const fetchImpl = o.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 5000);
  try {
    const res = await fetchImpl(o.url, {
      headers: { accept: 'application/json', ...o.headers },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) return { ok: false, error: 'redirect' };
    const max = o.maxBytes ?? 1024 * 1024;
    if (Number(res.headers.get('content-length') ?? 0) > max) return { ok: false, error: 'too_large' };
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > max) {
          await reader.cancel();
          controller.abort();
          return { ok: false, error: 'too_large' };
        }
        chunks.push(value);
      }
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    if (!res.ok) return { ok: false, status: res.status };
    try {
      return { ok: true, status: res.status, json: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
