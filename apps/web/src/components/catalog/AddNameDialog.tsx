import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  NAME_TYPES,
  type NameType,
  type Species,
  type SpeciesNameBody,
  speciesNameBodySchema,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { addSpeciesName, invalidateAfterCatalogWrite } from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, isValidationError, pageErrorMessage } from '../../lib/errors.ts';
import { NAME_TYPE_LABELS } from '../../lib/format.ts';
import { Alert, Button, Dialog, Field, Input, Select } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function addNameErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SPECIES_NAME_TAKEN':
        return 'This species already has that name.';
      case 'SPECIES_NOT_FOUND':
        return 'This species no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

const LOCAL_MESSAGES: Record<string, string> = {
  name: 'Enter the name.',
  language: 'Enter a two-letter language code, like pt.',
};

/**
 * Adds an alternative name to a species (RFC-60 R4, R9): the name, its type
 * (GBIF name / Synonym / Common name), and, per the type, a Language field —
 * shown and required only for a common name — and an optional GBIF usage key
 * — shown only for a GBIF name. Source is always optional; left blank, the
 * API defaults it to `'manual'`. Switching type away from common or gbif
 * clears the field that no longer applies, so a stale value never leaks into
 * a later submit under a different type — though the submitted body already
 * omits `language`/`gbifUsageKey` outside their type regardless, per
 * `speciesNameBodySchema`'s refinements. A name the species already carries
 * lands under the Name field. Mounted only while open.
 * @rfc RFC-13 R6
 * @rfc RFC-60 R4, R9
 */
export function AddNameDialog({
  species,
  onClose,
  onSaved,
}: {
  species: Species;
  onClose: () => void;
  onSaved: (species: Species) => void;
}) {
  const queryClient = useQueryClient();
  const ids = {
    name: useId(),
    type: useId(),
    language: useId(),
    source: useId(),
    key: useId(),
  };
  const [name, setName] = useState('');
  const [nameType, setNameType] = useState<NameType>('gbif');
  const [language, setLanguage] = useState('');
  const [source, setSource] = useState('');
  const [gbifUsageKey, setGbifUsageKey] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: SpeciesNameBody) => addSpeciesName(species.id, body),
    onSuccess: async (saved) => {
      await invalidateAfterCatalogWrite(queryClient, 'taxa');
      onSaved(saved);
    },
  });
  // A name the species already carries is the name field's own error, not the form's.
  const nameTaken = save.error instanceof ApiError && save.error.code === 'SPECIES_NAME_TAKEN';
  const errors: Record<string, string> = { ...fieldErrors(save.error), ...local };
  if (nameTaken) errors.name = addNameErrorMessage(save.error);

  function changeType(next: NameType) {
    setNameType(next);
    if (next !== 'common') setLanguage('');
    if (next !== 'gbif') setGbifUsageKey('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = gbifUsageKey.trim();
    const src = source.trim();
    const parsed = speciesNameBodySchema.safeParse({
      name: name.trim(),
      nameType,
      ...(nameType === 'common' ? { language: language.trim() } : {}),
      ...(src === '' ? {} : { source: src }),
      ...(nameType === 'gbif' && key !== '' ? { gbifUsageKey: key } : {}),
    });
    if (!parsed.success) {
      save.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        next[path] = LOCAL_MESSAGES[path] ?? issue.message;
      }
      setLocal(next);
      return;
    }
    setLocal({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog open title="Add alternative name" onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={ids.name} label="Name" error={errors.name}>
          <Input
            id={ids.name}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(errors.name)}
          />
        </Field>
        <Field id={ids.type} label="Type" error={errors.nameType}>
          <Select
            id={ids.type}
            value={nameType}
            onChange={(e) => changeType(e.target.value as NameType)}
          >
            {NAME_TYPES.map((type) => (
              <option key={type} value={type}>
                {NAME_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        {nameType === 'common' ? (
          <Field
            id={ids.language}
            label="Language"
            hint="Two-letter code, like pt."
            error={errors.language}
          >
            <Input
              id={ids.language}
              value={language}
              maxLength={2}
              onChange={(e) => setLanguage(e.target.value)}
              invalid={Boolean(errors.language)}
            />
          </Field>
        ) : null}
        <Field
          id={ids.source}
          label="Source (optional)"
          hint="Defaults to manual."
          error={errors.source}
        >
          <Input
            id={ids.source}
            value={source}
            maxLength={200}
            onChange={(e) => setSource(e.target.value)}
            invalid={Boolean(errors.source)}
          />
        </Field>
        {nameType === 'gbif' ? (
          <Field id={ids.key} label="GBIF usage key (optional)" error={errors.gbifUsageKey}>
            <Input
              id={ids.key}
              value={gbifUsageKey}
              maxLength={64}
              onChange={(e) => setGbifUsageKey(e.target.value)}
              invalid={Boolean(errors.gbifUsageKey)}
            />
          </Field>
        ) : null}
        {save.isError && !nameTaken && !isValidationError(save.error) ? (
          <Alert tone="error">{addNameErrorMessage(save.error)}</Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            Add name
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
