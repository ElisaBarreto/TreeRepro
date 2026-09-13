import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nameSchema, type User } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { adminKeys, updateUser } from '../../api/admin.ts';
import { Alert, Button, Field, Input, Section } from '../ui/index.ts';
import { userErrorMessage } from './user-errors.ts';

/**
 * The user's display name; `PATCH /api/admin/users/:id`. The form is keyed
 * by the current name so a save (or another section's write) re-seeds the
 * uncontrolled input instead of leaving the old value on screen.
 * @rfc RFC-50 R5
 */
export function UserNameSection({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [fieldError, setFieldError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (name: string) => updateUser(user.id, { name }),
    onSuccess: (next) => {
      queryClient.setQueryData(adminKeys.user(user.id), next);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '');
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      save.reset();
      setFieldError('Enter a name (up to 120 characters).');
      return;
    }
    setFieldError(null);
    save.mutate(parsed.data);
  }

  return (
    <Section id="name" title="Name" description="The name other curators see.">
      <form key={user.name} onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
        <Field id={id} label="Name" error={fieldError ?? undefined}>
          <Input
            id={id}
            name="name"
            defaultValue={user.name}
            maxLength={120}
            invalid={Boolean(fieldError)}
          />
        </Field>
        {save.isSuccess ? <Alert tone="success">Name saved.</Alert> : null}
        {save.isError ? <Alert tone="error">{userErrorMessage(save.error)}</Alert> : null}
        <div>
          <Button type="submit" pending={save.isPending}>
            Save name
          </Button>
        </div>
      </form>
    </Section>
  );
}
