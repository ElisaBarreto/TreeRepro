import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLATFORM_NAMES, type Platform, type User } from '@treerepro/contracts';
import { useState } from 'react';
import { adminKeys, listRoles, updateUser } from '../../api/admin.ts';
import { Alert, Badge, Button, Section } from '../ui/index.ts';
import { userErrorMessage } from './user-errors.ts';

/**
 * The user's roles on one platform (RFC-31 R16): checkboxes over
 * `GET /api/admin/roles` for `users.update` (saved as the platform's full id
 * list, RFC-50 R5), badges otherwise. The checked set starts from the user
 * and is re-seeded whenever the user's roles change (a save, or another
 * section's write).
 * @rfc RFC-50 R5, R14
 * @rfc RFC-31 R6, R7, R16
 * @rfc RFC-13 R3, R6
 */
export function UserRolesSection({
  user,
  platform,
  canEdit,
}: {
  user: User;
  platform: Platform;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: adminKeys.roles, queryFn: listRoles, enabled: canEdit });
  const held = user.roles.filter((r) => r.platform === platform);
  const seed = held
    .map((r) => r.id)
    .sort()
    .join(',');
  const [state, setState] = useState({ seed, checked: new Set(held.map((r) => r.id)) });
  if (state.seed !== seed) setState({ seed, checked: new Set(held.map((r) => r.id)) });
  const name = PLATFORM_NAMES[platform];
  const save = useMutation({
    mutationFn: (ids: string[]) => updateUser(user.id, { roles: ids, platform }),
    onSuccess: (next) => {
      queryClient.setQueryData(adminKeys.user(user.id), next);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
  const toggle = (id: string) => {
    const checked = new Set(state.checked);
    if (checked.has(id)) checked.delete(id);
    else checked.add(id);
    setState({ seed, checked });
  };
  // The hint about API keys applies only to a current holder of the admin system role.
  const holdsAdmin = (roles.data ?? []).some(
    (r) => r.isSystem && r.name === 'admin' && user.roles.some((u) => u.id === r.id),
  );
  const ordered = (roles.data ?? []).filter((r) => state.checked.has(r.id)).map((r) => r.id);

  return (
    <Section
      id={`roles-${platform}`}
      title={`${name} roles`}
      description={`What this user may do on ${name}. The admin role grants every permission, on both platforms.`}
    >
      {!canEdit ? (
        held.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {held.map((r) => (
              <Badge key={r.id}>{r.name}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-body text-mist-500">No roles on {name}.</p>
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
          {holdsAdmin ? (
            <p className="text-meta text-mist-500">
              Removing the admin role also revokes every API key this user holds.
            </p>
          ) : null}
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
