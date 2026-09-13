import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@treerepro/contracts';
import { useState } from 'react';
import { adminKeys, listRoles, updateUser } from '../../api/admin.ts';
import { Alert, Badge, Button, Section } from '../ui/index.ts';
import { userErrorMessage } from './user-errors.ts';

/**
 * The user's roles: checkboxes over `GET /api/admin/roles` for `users.update`
 * (saved as the full id list, RFC-50 R5), badges otherwise. The checked set
 * starts from the user and is re-seeded whenever the user's roles change
 * (a save, or another section's write).
 * @rfc RFC-50 R5
 * @rfc RFC-31 R6, R7
 * @rfc RFC-13 R3, R6
 */
export function UserRolesSection({ user, canEdit }: { user: User; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: adminKeys.roles, queryFn: listRoles, enabled: canEdit });
  const seed = user.roles
    .map((r) => r.id)
    .sort()
    .join(',');
  const [state, setState] = useState({ seed, checked: new Set(user.roles.map((r) => r.id)) });
  if (state.seed !== seed) setState({ seed, checked: new Set(user.roles.map((r) => r.id)) });
  const save = useMutation({
    mutationFn: (ids: string[]) => updateUser(user.id, { roles: ids }),
    onSuccess: (next) => {
      queryClient.setQueryData(adminKeys.user(user.id), next);
      // refetchType 'none': see the comment in UserPage.tsx's `settle` — an
      // immediate refetch here would also match this section's own query key
      // and overwrite the fresher `next` just written above.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'], refetchType: 'none' });
    },
  });
  const toggle = (id: string) => {
    const checked = new Set(state.checked);
    if (checked.has(id)) checked.delete(id);
    else checked.add(id);
    setState({ seed, checked });
  };
  const ordered = (roles.data ?? []).filter((r) => state.checked.has(r.id)).map((r) => r.id);

  return (
    <Section
      id="roles"
      title="Roles"
      description="What this user may do. The admin role grants every permission."
    >
      {!canEdit ? (
        user.roles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {user.roles.map((r) => (
              <Badge key={r.id}>{r.name}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-body text-mist-500">No roles.</p>
        )
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(ordered);
          }}
          className="flex flex-col gap-4"
        >
          {roles.isError ? <Alert tone="error">{userErrorMessage(roles.error)}</Alert> : null}
          <ul className="flex flex-col gap-2">
            {(roles.data ?? []).map((role) => (
              <li key={role.id}>
                <label className="flex items-center gap-3 text-body text-canopy-950">
                  <input
                    type="checkbox"
                    className="size-5 accent-pollen-500"
                    checked={state.checked.has(role.id)}
                    onChange={() => toggle(role.id)}
                  />
                  <span>{role.name}</span> {role.isSystem ? <Badge>system</Badge> : null}{' '}
                  {role.description ? (
                    <span className="text-meta text-mist-500">{role.description}</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
          {save.isSuccess ? <Alert tone="success">Roles saved.</Alert> : null}
          {save.isError ? <Alert tone="error">{userErrorMessage(save.error)}</Alert> : null}
          <div>
            <Button type="submit" pending={save.isPending} disabled={!roles.data}>
              Save roles
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
