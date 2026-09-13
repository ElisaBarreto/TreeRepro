import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateSpeciesBody,
  createSpeciesBodySchema,
  type Genus,
  NAME_SOURCES,
  type NameSource,
  type Species,
  type UpdateSpeciesBody,
  updateSpeciesBodySchema,
} from '@treerepro/contracts';
import { type FormEvent, useId, useRef, useState } from 'react';
import type { ZodError } from 'zod';
import {
  createFamily,
  createGenus,
  createSpecies,
  invalidateAfterCatalogWrite,
  updateSpecies,
} from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { datasetKeys, fetchFamilies, fetchGenera } from '../../api/dataset.ts';
import { fieldErrors, isValidationError, pageErrorMessage } from '../../lib/errors.ts';
import {
  Alert,
  Button,
  Combobox,
  type ComboboxOption,
  Dialog,
  Field,
  Input,
  Select,
} from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function speciesErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SPECIES_NAME_TAKEN':
        return 'A species with this name already exists.';
      case 'GENUS_NOT_FOUND':
      case 'FAMILY_NOT_FOUND':
        return 'The chosen taxon no longer exists. Reload the page.';
      case 'SPECIES_NOT_FOUND':
        return 'This species no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

function familyErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'FAMILY_NAME_TAKEN') {
    return 'A family with this name already exists.';
  }
  return pageErrorMessage(error);
}

const LOCAL_MESSAGES: Record<string, string> = { canonicalName: 'Enter the canonical name.' };

type SaveInput =
  | { kind: 'create'; body: CreateSpeciesBody }
  | { kind: 'update'; id: string; body: UpdateSpeciesBody };

function genusOption(genus: Genus): ComboboxOption {
  return { id: genus.id, label: genus.name, hint: genus.family?.name };
}

/**
 * The species form of RFC-60 R9: canonical name, name source, and the genus
 * searched by prefix (created inline when missing); the family select
 * narrows that search and is what an inline-created genus belongs to — the
 * body carries `genusId` only, the family is the genus's. Choosing a genus
 * of another family moves the family select to it; choosing a family drops
 * a genus of another family. A missing family is created in place of the
 * select (Enter there creates it). Without `species` it creates; with one it
 * edits and sends only the fields that differ (`genusId: null` detaches),
 * closing without a request when nothing changed. Mounted only while open.
 * @rfc RFC-13 R3, R6
 * @rfc RFC-60 R9
 */
export function SpeciesDialog({
  species,
  onClose,
  onSaved,
}: {
  species?: Species;
  onClose: () => void;
  onSaved: (species: Species) => void;
}) {
  const queryClient = useQueryClient();
  const ids = {
    name: useId(),
    source: useId(),
    family: useId(),
    newFamily: useId(),
    genus: useId(),
  };
  const [canonicalName, setCanonicalName] = useState(species?.canonicalName ?? '');
  const [nameSource, setNameSource] = useState<NameSource>(species?.nameSource ?? 'original');
  const [family, setFamily] = useState(species?.family?.id ?? '');
  const [newFamily, setNewFamily] = useState<string | null>(null);
  const [familyError, setFamilyError] = useState<string | undefined>(undefined);
  const [genus, setGenus] = useState<ComboboxOption | null>(
    species?.genus
      ? { id: species.genus.id, label: species.genus.name, hint: species.family?.name }
      : null,
  );
  const [local, setLocal] = useState<Record<string, string>>({});
  // Every genus the search or the inline create has shown, so choosing one
  // can move the family select to the genus's family.
  const generaById = useRef(new Map<string, Genus>());
  // The family of a chosen genus: from the search or the inline create that
  // showed it, or the species' own for the prefilled genus; `''` when none.
  function genusFamilyId(genusId: string): string {
    const known = generaById.current.get(genusId);
    if (known) return known.family?.id ?? '';
    return genusId === species?.genus?.id ? (species?.family?.id ?? '') : '';
  }
  // A genus belongs to a family, so a family chosen by the user drops a genus
  // of another family (as the species search form does) — the form never
  // shows a pair the API would not store.
  function chooseFamily(next: string) {
    setFamily(next);
    if (genus && genusFamilyId(genus.id) !== next) setGenus(null);
  }

  const families = useQuery({ queryKey: datasetKeys.families, queryFn: fetchFamilies });
  const addFamily = useMutation({
    mutationFn: (name: string) => createFamily({ name }),
    onSuccess: async (created) => {
      await invalidateAfterCatalogWrite(queryClient, 'taxa');
      chooseFamily(created.id);
      setNewFamily(null);
    },
  });
  const save = useMutation({
    mutationFn: (input: SaveInput) =>
      input.kind === 'create' ? createSpecies(input.body) : updateSpecies(input.id, input.body),
    onSuccess: async (saved) => {
      await invalidateAfterCatalogWrite(queryClient, 'taxa');
      onSaved(saved);
    },
  });
  // A taken name is the canonical name's own error, not the form's.
  const nameTaken = save.error instanceof ApiError && save.error.code === 'SPECIES_NAME_TAKEN';
  const errors: Record<string, string> = { ...fieldErrors(save.error), ...local };
  if (nameTaken) errors.canonicalName = speciesErrorMessage(save.error);
  const inlineFamilyError =
    familyError ?? (addFamily.isError ? familyErrorMessage(addFamily.error) : undefined);

  const searchGenera = async (term: string) => {
    const page = await fetchGenera({ familyId: family || undefined, q: term, limit: 20 });
    for (const item of page.data) generaById.current.set(item.id, item);
    return page.data.map(genusOption);
  };
  const createGenusInline = async (name: string) => {
    const created = await createGenus({ name, familyId: family || undefined });
    generaById.current.set(created.id, created);
    await invalidateAfterCatalogWrite(queryClient, 'taxa');
    return genusOption(created);
  };

  function submitFamily() {
    if (addFamily.isPending) return;
    const name = (newFamily ?? '').trim();
    if (name === '') {
      addFamily.reset();
      setFamilyError('Enter a family name.');
      return;
    }
    setFamilyError(undefined);
    addFamily.mutate(name);
  }

  function showIssues(error: ZodError) {
    save.reset();
    const next: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.');
      next[path] = LOCAL_MESSAGES[path] ?? issue.message;
    }
    setLocal(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = canonicalName.trim();
    const genusId = genus?.id ?? null;
    if (species === undefined) {
      const parsed = createSpeciesBodySchema.safeParse({
        canonicalName: name,
        nameSource,
        ...(genusId === null ? {} : { genusId }),
      });
      if (!parsed.success) return showIssues(parsed.error);
      setLocal({});
      save.mutate({ kind: 'create', body: parsed.data });
      return;
    }
    const diff: UpdateSpeciesBody = {};
    if (name !== species.canonicalName) diff.canonicalName = name;
    if (nameSource !== species.nameSource) diff.nameSource = nameSource;
    if (genusId !== (species.genus?.id ?? null)) diff.genusId = genusId;
    if (Object.keys(diff).length === 0) {
      onClose();
      return;
    }
    const parsed = updateSpeciesBodySchema.safeParse(diff);
    if (!parsed.success) return showIssues(parsed.error);
    setLocal({});
    save.mutate({ kind: 'update', id: species.id, body: parsed.data });
  }

  return (
    <Dialog
      open
      title={species ? 'Edit species' : 'New species'}
      onClose={onClose}
      closeDisabled={save.isPending}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={ids.name} label="Canonical name" error={errors.canonicalName}>
          <Input
            id={ids.name}
            value={canonicalName}
            maxLength={200}
            onChange={(e) => setCanonicalName(e.target.value)}
            invalid={Boolean(errors.canonicalName)}
          />
        </Field>
        <Field id={ids.source} label="Name source" error={errors.nameSource}>
          <Select
            id={ids.source}
            value={nameSource}
            onChange={(e) => setNameSource(e.target.value as NameSource)}
            invalid={Boolean(errors.nameSource)}
          >
            {NAME_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-2">
          {newFamily === null ? (
            <Field
              id={ids.family}
              label="Family"
              hint="Narrows the genus search; a genus created here belongs to it."
              error={errors.familyId ?? (families.isError ? 'Could not load families.' : undefined)}
            >
              <div className="flex items-center gap-2">
                {families.isPending ? (
                  // The select appears with its options, so an edit never
                  // shows "No family" for a species that has one.
                  <p className="grow text-meta text-mist-500">Loading families…</p>
                ) : (
                  <Select
                    id={ids.family}
                    value={family}
                    onChange={(e) => chooseFamily(e.target.value)}
                  >
                    <option value="">No family</option>
                    {(families.data ?? []).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    addFamily.reset();
                    setNewFamily('');
                  }}
                >
                  New family
                </Button>
              </div>
            </Field>
          ) : (
            <Field id={ids.newFamily} label="New family name" error={inlineFamilyError}>
              <div className="flex items-center gap-2">
                <Input
                  id={ids.newFamily}
                  value={newFamily}
                  maxLength={200}
                  onChange={(e) => setNewFamily(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter here creates the family; the form's default
                    // button would submit the species instead.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitFamily();
                    }
                  }}
                  invalid={Boolean(inlineFamilyError)}
                />
                <Button size="sm" pending={addFamily.isPending} onClick={submitFamily}>
                  Create
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setNewFamily(null);
                    setFamilyError(undefined);
                    addFamily.reset();
                  }}
                  disabled={addFamily.isPending}
                >
                  Cancel
                </Button>
              </div>
            </Field>
          )}
        </div>
        <Field id={ids.genus} label="Genus" error={errors.genusId}>
          <Combobox
            id={ids.genus}
            value={genus}
            onChange={(next) => {
              setGenus(next);
              const fam = next ? generaById.current.get(next.id)?.family?.id : undefined;
              if (fam && fam !== family) setFamily(fam);
            }}
            search={searchGenera}
            searchKey={`genera:${family}`}
            listLabel="Genus suggestions"
            placeholder="Type to search genera"
            onCreate={createGenusInline}
            invalid={Boolean(errors.genusId)}
          />
        </Field>
        {save.isError && !nameTaken && !isValidationError(save.error) ? (
          <Alert tone="error">{speciesErrorMessage(save.error)}</Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            {species ? 'Save' : 'Create species'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
