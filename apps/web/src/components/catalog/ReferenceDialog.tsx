import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CreateReferenceBody,
  createReferenceBodySchema,
  type ReferenceDetail,
  type UpdateReferenceBody,
  updateReferenceBodySchema,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import {
  createReference,
  invalidateAfterCatalogWrite,
  updateReference,
} from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, isValidationError } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Input } from '../ui/index.ts';
import {
  REFERENCE_DOI_TAKEN_MESSAGE,
  REFERENCE_KEY_TAKEN_MESSAGE,
  referenceErrorMessage,
} from './errors.ts';

const OPTIONAL = ['title', 'authors', 'journal', 'doi', 'url'] as const;

interface FormValues {
  citationKey: string;
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
  url: string;
}

function createBody(v: FormValues): CreateReferenceBody {
  const body: CreateReferenceBody = { citationKey: v.citationKey.trim() };
  for (const k of OPTIONAL) {
    const value = v[k].trim();
    if (value) body[k] = value;
  }
  if (v.year.trim()) body.year = Number(v.year);
  return body;
}

function updateBody(v: FormValues, r: ReferenceDetail): UpdateReferenceBody {
  const body: UpdateReferenceBody = {};
  if (v.citationKey.trim() !== r.citationKey) body.citationKey = v.citationKey.trim();
  for (const k of OPTIONAL) {
    const next: string | null = v[k].trim() || null;
    if (next !== r[k]) body[k] = next;
  }
  const year = v.year.trim() ? Number(v.year) : null;
  if (year !== r.year) body.year = year;
  return body;
}

/**
 * The taken-citation-key and taken-DOI conflicts point at the field they
 * refer to instead of the generic Alert, so they never duplicate the same
 * sentence in two places on the form.
 * @rfc RFC-13 R6
 */
function takenErrors(error: unknown): Record<string, string> {
  if (error instanceof ApiError) {
    if (error.code === 'REFERENCE_KEY_TAKEN') return { citationKey: REFERENCE_KEY_TAKEN_MESSAGE };
    if (error.code === 'REFERENCE_DOI_TAKEN') return { doi: REFERENCE_DOI_TAKEN_MESSAGE };
  }
  return {};
}

/**
 * Create (no `reference`) or edit a bibliographic reference. Edit sends only
 * the diff against the loaded entity: a changed field its value, an emptied
 * optional field `null`, an untouched field omitted, and an empty diff
 * closes the dialog without a request — the citation key is required and an
 * emptied one is refused locally rather than sent as `null`. Mounted only
 * while open, so its state starts fresh each time it opens.
 * @rfc RFC-61 R6
 * @rfc RFC-13 R6
 */
export function ReferenceDialog({
  reference,
  onClose,
  onSaved,
}: {
  reference?: ReferenceDetail;
  onClose: () => void;
  onSaved: (reference: ReferenceDetail) => void;
}) {
  const queryClient = useQueryClient();
  const ids = {
    citationKey: useId(),
    title: useId(),
    authors: useId(),
    year: useId(),
    journal: useId(),
    doi: useId(),
    url: useId(),
  };
  const [citationKey, setCitationKey] = useState(reference?.citationKey ?? '');
  const [title, setTitle] = useState(reference?.title ?? '');
  const [authors, setAuthors] = useState(reference?.authors ?? '');
  const [year, setYear] = useState(reference?.year?.toString() ?? '');
  const [journal, setJournal] = useState(reference?.journal ?? '');
  const [doi, setDoi] = useState(reference?.doi ?? '');
  const [url, setUrl] = useState(reference?.url ?? '');
  const [local, setLocal] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (body: CreateReferenceBody | UpdateReferenceBody) =>
      reference
        ? updateReference(reference.id, body as UpdateReferenceBody)
        : createReference(body as CreateReferenceBody),
    onSuccess: async (saved) => {
      await invalidateAfterCatalogWrite(queryClient, 'references');
      onSaved(saved);
    },
  });
  const taken = takenErrors(save.error);
  const errors = { ...fieldErrors(save.error), ...taken, ...local };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values: FormValues = { citationKey, title, authors, year, journal, doi, url };

    // A local error replaces the previous attempt's answer: without the
    // reset, a stale API Alert would sit beside the fresh field message.
    if (values.citationKey.trim() === '') {
      save.reset();
      setLocal({ citationKey: 'Enter a citation key.' });
      return;
    }
    if (reference && Object.keys(updateBody(values, reference)).length === 0) {
      onClose();
      return;
    }

    const candidate = reference ? updateBody(values, reference) : createBody(values);
    const schema = reference ? updateReferenceBodySchema : createReferenceBodySchema;
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      save.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join('.')] = issue.message;
      setLocal(next);
      return;
    }
    setLocal({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog
      open
      title={reference ? 'Edit reference' : 'New reference'}
      onClose={onClose}
      closeDisabled={save.isPending}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={ids.citationKey} label="Citation key" error={errors.citationKey}>
          <Input
            id={ids.citationKey}
            value={citationKey}
            maxLength={2000}
            onChange={(e) => setCitationKey(e.target.value)}
            invalid={Boolean(errors.citationKey)}
          />
        </Field>
        <Field id={ids.title} label="Title (optional)" error={errors.title}>
          <Input
            id={ids.title}
            value={title}
            maxLength={1000}
            onChange={(e) => setTitle(e.target.value)}
            invalid={Boolean(errors.title)}
          />
        </Field>
        <Field id={ids.authors} label="Authors (optional)" error={errors.authors}>
          <Input
            id={ids.authors}
            value={authors}
            maxLength={1000}
            onChange={(e) => setAuthors(e.target.value)}
            invalid={Boolean(errors.authors)}
          />
        </Field>
        <Field id={ids.year} label="Year (optional)" error={errors.year}>
          <Input
            id={ids.year}
            type="number"
            inputMode="numeric"
            min={1500}
            max={2100}
            step={1}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            invalid={Boolean(errors.year)}
          />
        </Field>
        <Field id={ids.journal} label="Journal (optional)" error={errors.journal}>
          <Input
            id={ids.journal}
            value={journal}
            maxLength={1000}
            onChange={(e) => setJournal(e.target.value)}
            invalid={Boolean(errors.journal)}
          />
        </Field>
        <Field id={ids.doi} label="DOI (optional)" error={errors.doi}>
          <Input
            id={ids.doi}
            value={doi}
            maxLength={500}
            onChange={(e) => setDoi(e.target.value)}
            invalid={Boolean(errors.doi)}
          />
        </Field>
        <Field id={ids.url} label="URL (optional)" error={errors.url}>
          <Input
            id={ids.url}
            value={url}
            maxLength={500}
            onChange={(e) => setUrl(e.target.value)}
            invalid={Boolean(errors.url)}
          />
        </Field>
        {save.isError && Object.keys(taken).length === 0 && !isValidationError(save.error) ? (
          <Alert tone="error">{referenceErrorMessage(save.error)}</Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            {reference ? 'Save' : 'Create reference'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
