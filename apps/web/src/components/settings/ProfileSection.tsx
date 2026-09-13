import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type MeResponse, nameSchema } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { updateName } from '../../api/me.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { ME_QUERY_KEY, useMe } from '../../lib/session.ts';
import { Alert, Button, Field, Input, Section } from '../ui/index.ts';

/** @rfc RFC-50 R11 */
export function ProfileSection() {
  const me = useMe();
  const queryClient = useQueryClient();
  const ids = { name: useId(), email: useId() };
  const [fieldError, setFieldError] = useState<string | null>(null);
  const save = useMutation({
    // Wrapped, not passed directly: TanStack Query calls `mutationFn` with a
    // second (context) argument that `updateName` must never see or forward.
    mutationFn: (name: string) => updateName(name),
    onSuccess: (user) => {
      queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, (old) =>
        old ? { ...old, user: { ...old.user, name: user.name } } : old,
      );
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
    <Section
      id="profile"
      title="Profile"
      description="The name other curators see next to your annotations."
    >
      <form onSubmit={submit} className="flex max-w-md flex-col gap-4" noValidate>
        <Field id={ids.email} label="Email">
          <Input id={ids.email} value={me.user.email} readOnly />
        </Field>
        <Field id={ids.name} label="Name" error={fieldError ?? undefined}>
          <Input
            id={ids.name}
            name="name"
            defaultValue={me.user.name}
            maxLength={120}
            invalid={Boolean(fieldError)}
          />
        </Field>
        {save.isSuccess ? <Alert tone="success">Name saved.</Alert> : null}
        {save.isError ? <Alert tone="error">{pageErrorMessage(save.error)}</Alert> : null}
        <div>
          <Button type="submit" pending={save.isPending}>
            Save name
          </Button>
        </div>
      </form>
    </Section>
  );
}
