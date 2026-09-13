import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type CreateRoleBody,
  createRoleBodySchema,
  type PermissionEntry,
  type Role,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { adminKeys, createRole, listPermissions, updateRole } from '../../api/admin.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, isValidationError, pageErrorMessage } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Input, Textarea } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function roleErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ROLE_NAME_TAKEN':
        return 'Another role already has this name.';
      case 'ROLE_IS_SYSTEM':
        return 'System roles cannot be changed.';
      case 'ROLE_NOT_FOUND':
        return 'This role no longer exists. Reload the page.';
      case 'PERMISSION_UNKNOWN':
        return 'One of the permissions is unknown. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

const RETIRED = /\(retired\)$/;

/**
 * The catalog grouped by resource prefix (`users.read` → `users`), catalog
 * order kept, retired keys (description ending in "(retired)") left out.
 * @rfc RFC-30 R1, R2
 */
export function groupPermissions(
  entries: PermissionEntry[],
): { resource: string; entries: PermissionEntry[] }[] {
  const groups: { resource: string; entries: PermissionEntry[] }[] = [];
  for (const entry of entries) {
    if (RETIRED.test(entry.description)) continue;
    const resource = entry.key.split('.')[0] ?? entry.key;
    const group = groups.find((g) => g.resource === resource);
    if (group) group.entries.push(entry);
    else groups.push({ resource, entries: [entry] });
  }
  return groups;
}

/**
 * Create (`POST /api/admin/roles`) or edit (`PATCH`, every field sent) a
 * role: name, description, permission checkboxes grouped by resource.
 * Retired keys the role already holds are kept in the payload though
 * hidden, so an edit never silently drops them. Mounted only while open.
 * @rfc RFC-50 R10
 * @rfc RFC-31 R3, R4
 * @rfc RFC-13 R6
 */
export function RoleDialog({
  role,
  onClose,
  onSaved,
}: {
  role?: Role;
  onClose: () => void;
  onSaved: (role: Role) => void;
}) {
  const ids = { name: useId(), description: useId() };
  const [checked, setChecked] = useState(() => new Set(role?.permissions ?? []));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const catalog = useQuery({ queryKey: adminKeys.permissions, queryFn: listPermissions });
  const save = useMutation({
    mutationFn: (body: CreateRoleBody) => (role ? updateRole(role.id, body) : createRole(body)),
    onSuccess: onSaved,
  });
  const serverErrors = fieldErrors(save.error);
  const nameError =
    localErrors.name ??
    serverErrors.name ??
    (save.error instanceof ApiError && save.error.code === 'ROLE_NAME_TAKEN'
      ? roleErrorMessage(save.error)
      : undefined);
  const formError =
    save.isError &&
    !isValidationError(save.error) &&
    !(save.error instanceof ApiError && save.error.code === 'ROLE_NAME_TAKEN')
      ? roleErrorMessage(save.error)
      : null;
  const groups = groupPermissions(catalog.data ?? []);
  const visible = new Set(groups.flatMap((g) => g.entries.map((e) => e.key)));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const permissions = [
      ...(catalog.data ?? [])
        .map((e) => e.key)
        .filter((key) => visible.has(key) && checked.has(key)),
      ...(role?.permissions ?? []).filter((key) => !visible.has(key)),
    ];
    const parsed = createRoleBodySchema.safeParse({
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      permissions,
    });
    if (!parsed.success) {
      save.reset();
      setLocalErrors({ name: 'Enter a name (up to 64 characters).' });
      return;
    }
    setLocalErrors({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog
      open
      title={role ? 'Edit role' : 'New role'}
      onClose={onClose}
      closeDisabled={save.isPending}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={ids.name} label="Name" error={nameError}>
          <Input
            id={ids.name}
            name="name"
            defaultValue={role?.name ?? ''}
            maxLength={64}
            autoComplete="off"
            invalid={Boolean(nameError)}
          />
        </Field>
        <Field id={ids.description} label="Description" error={serverErrors.description}>
          <Textarea
            id={ids.description}
            name="description"
            defaultValue={role?.description ?? ''}
            maxLength={500}
            rows={2}
          />
        </Field>
        {catalog.isError ? <Alert tone="error">{roleErrorMessage(catalog.error)}</Alert> : null}
        <div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
          {groups.map((group) => (
            <fieldset key={group.resource} className="flex flex-col gap-2">
              <legend className="mb-1 text-label font-bold uppercase tracking-[0.08em] text-canopy-800">
                {group.resource}
              </legend>
              {group.entries.map((entry) => (
                <label key={entry.key} className="flex items-start gap-3 text-body text-canopy-950">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0 accent-pollen-500"
                    checked={checked.has(entry.key)}
                    onChange={() => {
                      const next = new Set(checked);
                      if (next.has(entry.key)) next.delete(entry.key);
                      else next.add(entry.key);
                      setChecked(next);
                    }}
                  />
                  <span>
                    {entry.description}{' '}
                    <span className="ml-2 font-mono text-meta text-mist-500">{entry.key}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} disabled={!catalog.data}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
