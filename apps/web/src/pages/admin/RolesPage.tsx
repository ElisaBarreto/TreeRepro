import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@treerepro/contracts';
import { useState } from 'react';
import { adminKeys, deleteRole, listRoles } from '../../api/admin.ts';
import { RoleDialog, roleErrorMessage } from '../../components/admin/RoleDialog.tsx';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

const DASH = <span className="text-mist-500">—</span>;

type Editing = Role | 'new' | null;

/**
 * Every role: name (with a "system" badge for the built-in ones),
 * description, permission count (`'all'` only for `admin`; `manager` and
 * `contributor` are system roles too but show their stored permission count,
 * RFC-31 R11), and — with `roles.manage` on a non-system role — Edit/Delete.
 * "New role" opens the same dialog with no role. Deleting asks for
 * confirmation first.
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-50 R10
 * @rfc RFC-31 R5, R11
 */
export function RolesPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const canManage = hasPermission(me, 'roles.manage');
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const roles = useQuery({ queryKey: adminKeys.roles, queryFn: listRoles });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.roles });
      setDeleting(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Roles"
        description="Who may do what. A user holds any number of roles."
        actions={canManage ? <Button onClick={() => setEditing('new')}>New role</Button> : null}
      />
      {roles.error ? <Alert tone="error">{roleErrorMessage(roles.error)}</Alert> : null}
      {roles.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
      {!roles.isLoading && !roles.error && (roles.data?.length ?? 0) === 0 ? (
        <EmptyState title="No roles yet." />
      ) : null}
      {roles.data && roles.data.length > 0 ? (
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th>Permissions</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {roles.data.map((role) => (
              <Tr key={role.id}>
                <Td>
                  <span className="font-medium text-canopy-900">{role.name}</span>{' '}
                  {role.isSystem ? <Badge>system</Badge> : null}
                </Td>
                <Td>{role.description || DASH}</Td>
                <Td>{role.name === 'admin' ? 'all' : role.permissions.length}</Td>
                <Td>
                  {canManage && !role.isSystem ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Edit ${role.name}`}
                        onClick={() => setEditing(role)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        aria-label={`Delete ${role.name}`}
                        onClick={() => setDeleting(role)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
      {editing ? (
        <RoleDialog
          role={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: adminKeys.roles });
            setEditing(null);
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="Users holding this role lose its permissions at once."
          confirmLabel="Delete"
          danger
          pending={remove.isPending}
          error={remove.isError ? roleErrorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(deleting.id)}
          onClose={() => {
            remove.reset();
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}
