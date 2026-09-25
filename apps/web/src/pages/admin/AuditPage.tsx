import { useQuery } from '@tanstack/react-query';
import { AUDIT_ACTIONS, type AuditLogEntry } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { z } from 'zod';
import { adminKeys, listUsers, queryAudit } from '../../api/admin.ts';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatDateTime, truncate } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const DASH = <span className="text-mist-500">—</span>;
const AGENT_MAX = 40;
const USERS_FOR_NAMES = 200;

interface Filters {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
}

/** The first eight characters of a UUID — enough to tell entries apart in a column. @rfc RFC-13 R9 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

const DATETIME_LOCAL_MINUTES = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATETIME_LOCAL_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

// A datetime-local value (`2026-09-13T10:00`, UTC) as the ISO instant the
// API takes: append the seconds and the `Z` designator the input lacks (or
// just the `Z` when it already has seconds), then let `Date` parse it.
// `undefined` for an empty value; `null` when the raw text (a browser
// without `datetime-local` support falls back to a text input) does not
// match the expected shape at all — checked with a regexp rather than left
// to `Date`, whose loose, non-ISO parsing can turn unrelated text into a
// spurious valid date instead of `Invalid Date`.
function toInstant(local: string): string | undefined | null {
  if (!local) return undefined;
  const hasSeconds = DATETIME_LOCAL_SECONDS.test(local);
  if (!hasSeconds && !DATETIME_LOCAL_MINUTES.test(local)) return null;
  const date = new Date(hasSeconds ? `${local}Z` : `${local}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The audit log, newest first (RFC-51 R3): actor, action, time range
 * filters applied on demand (the form validates the id and the range
 * locally, the API is the authority); the actor column shows the user's
 * name when the session may list users (one page of names), the short id
 * otherwise; metadata folds behind a disclosure.
 * @rfc RFC-13 R2, R3, R4, R6
 * @rfc RFC-51 R1, R2, R3
 */
export function AuditPage() {
  const me = useMe();
  const ids = { actor: useId(), action: useId(), from: useId(), to: useId(), list: useId() };
  const [filters, setFilters] = useState<Filters>({});
  const [errors, setErrors] = useState<{
    actor?: string;
    from?: string;
    to?: string;
    range?: string;
  }>({});
  const list = usePagedList(adminKeys.audit({ ...filters }), (cursor, limit) =>
    queryAudit({ ...filters, cursor, limit }),
  );
  const canReadUsers = hasPermission(me, 'users.read');
  const users = useQuery({
    queryKey: adminKeys.users({ limit: USERS_FOR_NAMES }),
    queryFn: () => listUsers({ limit: USERS_FOR_NAMES }),
    enabled: canReadUsers,
  });
  const names = new Map((users.data?.data ?? []).map((u) => [u.id, u.name]));

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const actor = String(form.get('actor') ?? '').trim();
    const action = String(form.get('action') ?? '');
    const from = toInstant(String(form.get('from') ?? ''));
    const to = toInstant(String(form.get('to') ?? ''));
    const next: { actor?: string; from?: string; to?: string; range?: string } = {};
    if (actor && !z.uuid().safeParse(actor).success) next.actor = 'Enter a user id.';
    if (from === null) next.from = 'Enter a date and time.';
    if (to === null) next.to = 'Enter a date and time.';
    if (typeof from === 'string' && typeof to === 'string' && Date.parse(from) > Date.parse(to))
      next.range = 'From must not be later than To.';
    setErrors(next);
    if (next.actor || next.from || next.to || next.range) return;
    setFilters({
      actor: actor || undefined,
      action: action || undefined,
      from: from ?? undefined,
      to: to ?? undefined,
    });
  }

  return (
    <>
      <PageHeader title="Audit log" description="Who did what, and when. Newest first." />
      <div className="flex flex-col gap-6">
        <form
          onSubmit={apply}
          className="grid gap-4 md:grid-cols-2 md:items-end xl:grid-cols-[1fr_1fr_auto_auto_auto]"
          noValidate
        >
          <Field id={ids.actor} label="Actor" error={errors.actor}>
            <Input
              id={ids.actor}
              name="actor"
              list={canReadUsers ? ids.list : undefined}
              autoComplete="off"
              placeholder="User id"
              invalid={Boolean(errors.actor)}
            />
          </Field>
          {canReadUsers ? (
            <datalist id={ids.list}>
              {(users.data?.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </datalist>
          ) : null}
          <Field id={ids.action} label="Action">
            <Select id={ids.action} name="action" defaultValue="">
              <option value="">Any</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.from} label="From (UTC)" error={errors.from ?? errors.range}>
            <Input
              id={ids.from}
              name="from"
              type="datetime-local"
              invalid={Boolean(errors.from ?? errors.range)}
            />
          </Field>
          <Field id={ids.to} label="To (UTC)" error={errors.to}>
            <Input
              id={ids.to}
              name="to"
              type="datetime-local"
              invalid={Boolean(errors.to ?? errors.range)}
            />
          </Field>
          <div>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </div>
        </form>
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No entries match." />
        ) : null}
        {list.items.length > 0 ? <AuditTable items={list.items} names={names} /> : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
    </>
  );
}

function AuditTable({ items, names }: { items: AuditLogEntry[]; names: Map<string, string> }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>At (UTC)</Th>
          <Th>Actor</Th>
          <Th>Action</Th>
          <Th>Target</Th>
          <Th>IP</Th>
          <Th>User agent</Th>
          <Th>Details</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((entry) => (
          <Tr key={entry.id}>
            <Td className="whitespace-nowrap tabular-nums">{formatDateTime(entry.at)}</Td>
            <Td>
              {entry.actorUserId
                ? (names.get(entry.actorUserId) ?? (
                    <span className="font-mono">{shortId(entry.actorUserId)}</span>
                  ))
                : DASH}
            </Td>
            <Td className="font-mono">{entry.action}</Td>
            <Td>
              {entry.targetType && entry.targetId ? (
                <span>
                  {entry.targetType} <span className="font-mono">{shortId(entry.targetId)}</span>
                </span>
              ) : (
                DASH
              )}
            </Td>
            <Td className="font-mono">{entry.ip ?? DASH}</Td>
            <Td>
              {entry.userAgent ? (
                <span title={entry.userAgent}>{truncate(entry.userAgent, AGENT_MAX)}</span>
              ) : (
                DASH
              )}
            </Td>
            <Td>
              {Object.keys(entry.metadata).length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-meta text-canopy-800">Metadata</summary>
                  <pre className="mt-2 max-w-xs overflow-x-auto rounded bg-mist-50 p-2 font-mono text-meta">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </details>
              ) : (
                DASH
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
