import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HelpSection } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { createHelpSection, helpKeys, updateHelpSection } from '../../api/help.ts';
import { fieldErrors, pageErrorMessage } from '../../lib/errors.ts';
import { Alert, Button, Field, Input } from '../ui/index.ts';
import { RichTextEditor } from './RichTextEditor.tsx';

/**
 * Edits a section in place, or adds one at the end of `topicId` when no
 * `section` is given (RFC-73 R6, R7). Save / Cancel; the anchor is set by
 * the API on creation and never changes.
 * @rfc RFC-73 R6, R7
 */
export function HelpSectionEditor({
  topicId,
  section,
  onDone,
}: {
  topicId: string;
  section?: HelpSection;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = { title: useId(), body: useId() };
  const [title, setTitle] = useState(section?.title ?? '');
  const [bodyHtml, setBodyHtml] = useState(section?.bodyHtml ?? '');
  const save = useMutation({
    mutationFn: () =>
      section
        ? updateHelpSection(section.id, { title: title.trim(), bodyHtml })
        : createHelpSection(topicId, { title: title.trim(), bodyHtml }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: helpKeys.all });
      onDone();
    },
  });
  const errors = fieldErrors(save.error);
  const taken = save.error instanceof ApiError && save.error.code === 'HELP_ANCHOR_TAKEN';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={section ? `Edit ${section.title || 'section'}` : 'New section'}
      className="my-4 flex flex-col gap-3 rounded-[10px] border border-pollen-500/40 bg-white p-4"
    >
      <Field
        id={ids.title}
        label="Section title (optional)"
        error={
          errors.title ?? (taken ? 'Another section of this topic has this title.' : undefined)
        }
      >
        <Input
          id={ids.title}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          invalid={Boolean(errors.title) || taken}
        />
      </Field>
      <RichTextEditor id={ids.body} value={bodyHtml} onChange={setBodyHtml} />
      {errors.bodyHtml ? <Alert tone="error">{errors.bodyHtml}</Alert> : null}
      {save.error && !taken && Object.keys(errors).length === 0 ? (
        <Alert tone="error">{pageErrorMessage(save.error)}</Alert>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" pending={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
