import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateSpeciesBody,
  createSpeciesBodySchema,
  type Genus,
  type Lookup,
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
import { matchTaxon } from '../../api/proposals.ts';
import { fieldErrors, isValidationError } from '../../lib/errors.ts';
import { preferredMatch } from '../curation/proposal-prefill.ts';
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
import {
  familyCreateErrorMessage,
  genusCreateErrorMessage,
  speciesErrorMessage,
} from './errors.ts';
import { SpeciesNameFields } from './SpeciesNameFields.tsx';

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
 * Edit mode also shows an "Active — visible to contributors" checkbox
 * (RFC-33 R7); create has none, the API defaulting a fresh species to active.
 *
 * Create mode carries a **Look up** button (RFC-81 R4): it asks
 * `GET /api/taxonomy/match` what GBIF calls the typed name and fills the
 * family and the genus from the answer. It fills only taxa the catalog
 * already holds — the family select and the genus combobox address rows by
 * id — and says in one line what GBIF named that is still missing, rather
 * than creating taxa nobody asked for.
 *
 * Approving a proposal into a species is `ApproveProposalDialog`, not a mode
 * of this one: it posts to a different route, and its genus and family are
 * names the API resolves rather than ids this form has to find first. The
 * two share the canonical name and its source through `SpeciesNameFields`,
 * which is all they genuinely have in common.
 * @rfc RFC-13 R3, R6
 * @rfc RFC-60 R9
 * @rfc RFC-33 R7
 * @rfc RFC-81 R4
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
  const ids = { family: useId(), newFamily: useId(), genus: useId() };
  const [canonicalName, setCanonicalName] = useState(species?.canonicalName ?? '');
  const [nameSource, setNameSource] = useState<NameSource>(species?.nameSource ?? 'original');
  // What the last Look up found that the catalog does not hold; `null` until
  // one has run.
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  // Edit mode only: create has no `active` in its body, and a fresh species
  // is always active by the API's default.
  const [active, setActive] = useState(species?.active ?? true);
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
  // The whole look-up, answer and fill alike, is the mutation: `applyLookup`
  // awaits the catalog, so leaving it to run loose in `onSuccess` would turn
  // a failed genus search into an unhandled rejection and a half-applied
  // form with nothing said about it.
  const look = useMutation({
    mutationFn: async (name: string) => {
      await applyLookup(await matchTaxon(name));
    },
  });
  // A taken name is the canonical name's own error, not the form's.
  const nameTaken = save.error instanceof ApiError && save.error.code === 'SPECIES_NAME_TAKEN';
  const errors: Record<string, string> = { ...fieldErrors(save.error), ...local };
  if (nameTaken) errors.canonicalName = speciesErrorMessage(save.error);
  const inlineFamilyError =
    familyError ?? (addFamily.isError ? familyCreateErrorMessage(addFamily.error) : undefined);

  const searchGenera = async (term: string) => {
    const page = await fetchGenera({ familyId: family || undefined, q: term, limit: 20 });
    for (const item of page.data) generaById.current.set(item.id, item);
    return page.data.map(genusOption);
  };

  // Fills the family select and the genus combobox from a lookup answer.
  // Both controls address a catalog row by id, so only a taxon the catalog
  // already holds can be selected; what GBIF named and the catalog lacks is
  // reported in one line instead — the family's name into the inline "New
  // family" field, ready for the reviewer to create, and the genus's name in
  // the note, where the combobox's own `Create "…"` option takes over.
  async function applyLookup(lookup: Lookup): Promise<void> {
    const match = preferredMatch(lookup);
    if (!match || (match.family === null && match.genus === null)) {
      setLookupNote('GBIF named no family or genus for this name.');
      return;
    }
    const missing: string[] = [];
    let familyId = family;
    if (match.family !== null) {
      const known = (families.data ?? []).find(
        (f) => f.name.toLowerCase() === match.family?.toLowerCase(),
      );
      if (known) {
        familyId = known.id;
        chooseFamily(known.id);
      } else {
        addFamily.reset();
        setNewFamily(match.family);
        missing.push(`the family ${match.family} (filled in above — press Create)`);
      }
    }
    const matched = `Matched ${match.scientificName ?? match.canonicalName ?? 'nothing'}.`;
    if (match.genus !== null) {
      try {
        const page = await fetchGenera({
          familyId: familyId || undefined,
          q: match.genus,
          limit: 20,
        });
        for (const item of page.data) generaById.current.set(item.id, item);
        const known = page.data.find((g) => g.name.toLowerCase() === match.genus?.toLowerCase());
        if (known) setGenus(genusOption(known));
        else missing.push(`the genus ${match.genus}`);
      } catch {
        // The lookup itself answered; it is the catalog side that failed.
        // Whatever was filled in above stands, and the line says the rest
        // is unknown rather than leaving the form half-applied in silence.
        setLookupNote(
          `${matched} GBIF names the genus ${match.genus}, but the catalog could not be searched just now — pick or create the genus yourself.`,
        );
        return;
      }
    }
    setLookupNote(
      missing.length === 0
        ? `${matched} Family and genus filled in.`
        : `${matched} The catalog does not have ${missing.join(' or ')}.`,
    );
  }
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
    if (active !== species.active) diff.active = active;
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
        <SpeciesNameFields
          canonicalName={canonicalName}
          onCanonicalNameChange={setCanonicalName}
          nameSource={nameSource}
          onNameSourceChange={setNameSource}
          errors={{ canonicalName: errors.canonicalName, nameSource: errors.nameSource }}
          hint={lookupNote ?? undefined}
          trailing={
            species === undefined ? (
              <Button
                size="sm"
                variant="secondary"
                pending={look.isPending}
                disabled={canonicalName.trim().length < 3}
                onClick={() => {
                  setLookupNote(null);
                  look.mutate(canonicalName.trim());
                }}
              >
                Look up
              </Button>
            ) : undefined
          }
        >
          {look.isError ? (
            <Alert tone="error">The taxonomy lookup could not be completed. Try again.</Alert>
          ) : null}
        </SpeciesNameFields>
        {newFamily === null ? (
          <Field
            id={ids.family}
            label="Family"
            hint="Narrows the genus search; a genus created here belongs to it."
            error={errors.familyId ?? (families.isError ? 'Could not load families.' : undefined)}
            trailing={
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
            }
          >
            {families.isPending ? (
              // The select appears with its options, so an edit never
              // shows "No family" for a species that has one.
              <p className="text-meta text-mist-500">Loading families…</p>
            ) : (
              <Select
                id={ids.family}
                value={family}
                onChange={(e) => chooseFamily(e.target.value)}
                invalid={Boolean(errors.familyId) || families.isError}
              >
                <option value="">No family</option>
                {(families.data ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field
            id={ids.newFamily}
            label="New family name"
            error={inlineFamilyError}
            trailing={
              <>
                <Button size="sm" pending={addFamily.isPending} onClick={submitFamily}>
                  Create
                </Button>
                {/* Not "Cancel": the form's own Cancel sits below, and two would read as one. */}
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
                  Discard
                </Button>
              </>
            }
          >
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
          </Field>
        )}
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
            createErrorMessage={genusCreateErrorMessage}
            invalid={Boolean(errors.genusId)}
          />
        </Field>
        {species ? (
          <label className="flex h-11 items-center gap-2.5 text-body text-canopy-900">
            <input
              type="checkbox"
              className="size-5 accent-canopy-700"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active — visible to contributors
          </label>
        ) : null}
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
