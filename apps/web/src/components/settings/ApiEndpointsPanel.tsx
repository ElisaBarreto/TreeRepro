import { useQuery } from '@tanstack/react-query';
import type { ApiEndpoint } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { listApiKeyEndpoints } from '../../api/me.ts';
import { Input } from '../ui/index.ts';

const LABEL = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';

// Not exported: no @rfc tag needed (RFC-00 R6 applies to exports only).
// `/api/records/pending` → `records`.
function areaOf(path: string): string {
  return path.split('/')[2] ?? '';
}

function groupByArea(endpoints: readonly ApiEndpoint[]): [string, ApiEndpoint[]][] {
  const groups = new Map<string, ApiEndpoint[]>();
  for (const e of endpoints) groups.set(areaOf(e.path), [...(groups.get(areaOf(e.path)) ?? []), e]);
  return [...groups];
}

/**
 * How to call the API with a key, and every route a key reaches (the API
 * computes the list from the mounted routes, so it never drifts), grouped by
 * area and filterable. Only rendered for a user who may hold keys.
 * @rfc RFC-82 R22
 */
export function ApiEndpointsPanel() {
  const filterId = useId();
  const [filter, setFilter] = useState('');
  const endpoints = useQuery({
    queryKey: ['me', 'api-keys', 'endpoints'],
    queryFn: listApiKeyEndpoints,
  });
  const needle = filter.trim().toLowerCase();
  const shown = (endpoints.data ?? []).filter(
    (e) =>
      needle === '' ||
      `${e.method} ${e.path} ${e.summary} ${e.permission ?? ''}`.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-4 border-t border-canopy-700/10 pt-5">
      <div className="flex flex-col gap-2">
        <h3 className={LABEL}>Using your key</h3>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-body">
          <dt className="text-mist-500">Base URL</dt>
          <dd className="break-all font-mono text-meta">{window.location.origin}</dd>
          <dt className="text-mist-500">Header</dt>
          <dd className="break-all font-mono text-meta">Authorization: Bearer tr_live_…</dd>
          <dt className="text-mist-500">Guide</dt>
          <dd className="font-mono text-meta">GET /api/docs</dd>
          <dt className="text-mist-500">Reference</dt>
          <dd className="font-mono text-meta">GET /api/docs/openapi.json</dd>
        </dl>
        <p className="text-meta text-mist-500">
          The guide and the reference answer a key only, not this session.
        </p>
      </div>
      {endpoints.isError ? (
        <p className="text-meta text-mist-500">The endpoint list could not be loaded.</p>
      ) : null}
      {endpoints.data ? (
        <details className="group">
          <summary className={`${LABEL} cursor-pointer select-none`}>
            {`Endpoints (${endpoints.data.length})`}
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            <Input
              id={filterId}
              aria-label="Filter endpoints"
              placeholder="Filter by path, summary or permission"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {shown.length === 0 ? (
              <p className="text-meta text-mist-500">No endpoint matches.</p>
            ) : null}
            {groupByArea(shown).map(([area, rows]) => (
              <div key={area} className="flex flex-col gap-1">
                <h4 className="font-semibold text-canopy-950">{area}</h4>
                <ul className="flex flex-col divide-y divide-canopy-700/10">
                  {rows.map((e) => (
                    <li key={`${e.method} ${e.path}`} className="flex flex-col gap-0.5 py-2">
                      <span className="flex gap-3 font-mono text-meta">
                        <span className="w-14 shrink-0 font-semibold text-canopy-800">
                          {e.method}
                        </span>
                        <span className="break-all">{e.path}</span>
                      </span>
                      <span className="pl-[4.25rem] text-meta text-mist-500">
                        {e.summary} ·{' '}
                        <span className="font-mono">{e.permission ?? 'key only'}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
