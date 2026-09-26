import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateApiKeyBody } from '@treerepro/contracts';
import { type FormEvent, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { createApiKey, listApiKeys, revokeApiKey } from '../../api/me.ts';
import { GENERIC_MESSAGE } from '../../lib/errors.ts';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Section,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui/index.ts';

const KEYS_KEY = ['me', 'api-keys'] as const;

// Not exported: no @rfc tag needed (RFC-00 R6 applies to exports only).
function formatWhen(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
}

function createErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  switch (error.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Your current password is incorrect.';
    case 'AUTH_TOTP_INVALID':
      return 'The verification code is not valid.';
    case 'AUTH_TOTP_NOT_ENABLED':
      return 'Enable two-factor authentication first.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment and try again.';
    default:
      return GENERIC_MESSAGE;
  }
}

const TONE = { active: 'green', expired: 'neutral', revoked: 'neutral' } as const;

/**
 * Hidden unless the API says the user may hold keys; the secret is shown once
 * and leaves the mutation cache with the section (gcTime 0, as PasswordSection).
 * @rfc RFC-82 R1, R2, R7
 */
export function ApiKeysSection() {
  const ids = { name: useId(), password: useId(), code: useId() };
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const keys = useQuery({ queryKey: KEYS_KEY, queryFn: listApiKeys });
  const create = useMutation({
    // Wrapped, not passed bare: TanStack Query calls mutationFn with a second
    // (context) argument that a directly-passed reference — and its mock in
    // tests — would otherwise also receive (as PasswordSection wraps its own).
    mutationFn: (body: CreateApiKeyBody) => createApiKey(body),
    gcTime: 0,
    onSuccess: (out) => {
      setSecret(out.secret);
      formRef.current?.reset();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS_KEY }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS_KEY }),
  });

  if (!keys.data?.eligible) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSecret(null);
    create.mutate(
      {
        name: String(data.get('name') ?? ''),
        password: String(data.get('password') ?? ''),
        code: String(data.get('code') ?? ''),
      },
      // Drops the password and code from `variables` right away (RFC-21 R7 pattern).
      { onSettled: () => create.reset() },
    );
  }

  return (
    <Section
      id="api-keys"
      title="API keys"
      description="Personal keys for scripts. Each key expires after 90 days."
    >
      {secret ? (
        <Alert tone="success">
          Copy this key now. It will not be shown again.
          <code className="mt-2 block break-all font-mono text-meta">{secret}</code>
        </Alert>
      ) : null}
      {create.isError ? <Alert tone="error">{createErrorMessage(create.error)}</Alert> : null}
      {revoke.isError ? <Alert tone="error">{GENERIC_MESSAGE}</Alert> : null}
      {keys.data.keys.length > 0 ? (
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th>Expires</Th>
              <Th>Last used</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {keys.data.keys.map((k) => (
              <Tr key={k.id}>
                <Td>
                  {k.name} <Badge tone={TONE[k.state]}>{k.state}</Badge>
                </Td>
                <Td className="font-mono">{`tr_live_${k.prefix}…`}</Td>
                <Td>{formatWhen(k.expiresAt)}</Td>
                <Td>{formatWhen(k.lastUsedAt)}</Td>
                <Td className="text-right">
                  {k.state === 'active' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Revoke ${k.name}`}
                      pending={revoke.isPending && revoke.variables === k.id}
                      onClick={() => revoke.mutate(k.id)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
      <form ref={formRef} onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
        <Field id={ids.name} label="Key name">
          <Input id={ids.name} name="name" maxLength={60} required />
        </Field>
        <Field id={ids.password} label="Current password">
          <Input
            id={ids.password}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field id={ids.code} label="Verification code">
          <Input
            id={ids.code}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </Field>
        <div>
          <Button type="submit" pending={create.isPending}>
            Create key
          </Button>
        </div>
      </form>
    </Section>
  );
}
