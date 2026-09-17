import { useQuery } from '@tanstack/react-query';
import {
  type CreateRecordBody,
  type CreateRecordsResult,
  createRecordBodySchema,
  type Dictionary,
  type RecordDetail,
  type Trait,
  type TraitRef,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { createReference } from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { createRecords } from '../../api/curation.ts';
import { datasetKeys, fetchDictionary, searchReferences } from '../../api/dataset.ts';
import { fieldErrors, pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { referenceErrorMessage } from '../catalog/errors.ts';
import {
  Alert,
  Button,
  Combobox,
  type ComboboxOption,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
} from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function addValueErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RECORD_DUPLICATE':
        return 'This claim already exists. Confirm the existing record instead.';
      case 'SPECIES_NOT_FOUND':
      case 'TRAIT_NOT_FOUND':
      case 'REFERENCE_NOT_FOUND':
        return 'Something this record refers to no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

const LOCAL_MESSAGES: Record<string, string> = {
  traitId: 'Choose a trait.',
  value: 'Enter a value.',
  'value.levelId': 'Choose a level.',
  'value.numeric': 'Enter a number.',
  primaryReferenceId: 'Choose the primary reference.',
};

function activeTraits(dictionary: Dictionary | undefined): Trait[] {
  return dictionary?.flatMap((c) => c.traits).filter((t) => t.active) ?? [];
}
// The unit rides on the suggestion row only (`description`, not `hint`):
// once chosen, the value field (or the preselected-trait paragraph) shows
// it for the same trait, and a badge hint would repeat it.
function traitOption(trait: Pick<TraitRef, 'id' | 'key' | 'unit'>): ComboboxOption {
  return { id: trait.id, label: humaniseKey(trait.key), description: trait.unit ?? undefined };
}
function referenceOption(reference: {
  id: string;
  citationKey: string;
  year?: number | null;
}): ComboboxOption {
  return {
    id: reference.id,
    label: reference.citationKey,
    hint: reference.year ? String(reference.year) : undefined,
  };
}

/**
 * The form of RFC-65 R1: trait (from the dictionary, active traits only,
 * fixed when opened from a trait card), the value control the trait's type
 * needs (a level select or a number in the trait's unit), the primary
 * reference (searched; created inline with `references.manage`), an optional
 * secondary reference, the value as written in the source, a note. Validated
 * with the shared schema before sending; API field errors land under their
 * fields; a duplicate claim links to the existing record. Mounted only while
 * open, so its state starts fresh each time.
 * @rfc RFC-13 R6
 * @rfc RFC-65 R1, R2
 */
export function AddValueDialog({
  speciesId,
  initialTrait = null,
  onClose,
  onCreated,
  onOpenRecord,
}: {
  speciesId: string;
  initialTrait?: TraitRef | null;
  onClose: () => void;
  onCreated: (record: RecordDetail) => void;
  onOpenRecord: (id: string) => void;
}) {
  const me = useMe();
  const ids = {
    trait: useId(),
    level: useId(),
    numeric: useId(),
    primary: useId(),
    secondary: useId(),
    raw: useId(),
    note: useId(),
  };
  const dictionary = useQuery({ queryKey: datasetKeys.dictionary, queryFn: fetchDictionary });
  const traits = activeTraits(dictionary.data);
  const [trait, setTrait] = useState<ComboboxOption | null>(
    initialTrait ? traitOption(initialTrait) : null,
  );
  const selected = traits.find((t) => t.id === trait?.id);
  const valueType = selected?.valueType ?? initialTrait?.valueType;
  const unit = selected?.unit ?? initialTrait?.unit ?? null;
  const levels = selected?.levels.filter((l) => l.active) ?? [];
  const [levelId, setLevelId] = useState('');
  const [numeric, setNumeric] = useState('');
  const [primary, setPrimary] = useState<ComboboxOption | null>(null);
  const [secondary, setSecondary] = useState<ComboboxOption | null>(null);
  const [rawValue, setRawValue] = useState('');
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const canCreateReference = hasPermission(me, 'references.manage');

  const save = useRecordWrite<CreateRecordBody, CreateRecordsResult>({
    write: createRecords,
    speciesId,
    onInvalidated: (result) => {
      const [first] = result.created;
      if (first) onCreated?.(first);
    },
  });
  // The API names a source by its position (`sources.references.<i>`, RFC-70
  // R3); this form still has the two fixed slots, so index 0 is the primary
  // reference field and index 1 the secondary one.
  const serverErrors = fieldErrors(save.error);
  const sourceError = (index: number) =>
    Object.entries(serverErrors).find(([path]) =>
      path.startsWith(`sources.references.${index}`),
    )?.[1] ?? (index === 0 ? serverErrors.sources : undefined);
  const errors: Record<string, string | undefined> = {
    ...serverErrors,
    primaryReferenceId: sourceError(0),
    secondaryReferenceId: sourceError(1),
    ...local,
  };
  const duplicateId =
    save.error instanceof ApiError && save.error.code === 'RECORD_DUPLICATE'
      ? save.error.details?.find((d) => d.path.startsWith('sources.references.') && d.message)
          ?.message
      : undefined;

  const searchTraits = async (term: string) => {
    const needle = term.toLowerCase();
    return traits
      .filter((t) => t.key.includes(needle) || humaniseKey(t.key).toLowerCase().includes(needle))
      .slice(0, 20)
      .map(traitOption);
  };
  const searchRefs = async (term: string) =>
    (await searchReferences({ q: term, limit: 20 })).data.map(referenceOption);
  const createRef = async (text: string) =>
    referenceOption(await createReference({ citationKey: text }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Local, per-required-field checks first: `createRecordBodySchema.value`
    // is a plain `z.union` of the categorical/quantitative shapes, so a bad
    // number (`NaN`) fails both branches and Zod reports one `invalid_union`
    // issue at the union's own path (`value`), never reaching the nested
    // `value.numeric`/`value.levelId` paths the messages below key on. Only
    // once every required field is present does the schema parse run, to
    // catch what these checks don't (out-of-range numbers, lengths, …).
    const required: Record<string, string> = {};
    if (!trait) required.traitId = LOCAL_MESSAGES.traitId ?? '';
    if (valueType === 'categorical' && levelId === '') {
      required['value.levelId'] = LOCAL_MESSAGES['value.levelId'] ?? '';
    }
    if (valueType === 'quantitative' && (numeric.trim() === '' || Number.isNaN(Number(numeric)))) {
      required['value.numeric'] = LOCAL_MESSAGES['value.numeric'] ?? '';
    }
    if (!primary) required.primaryReferenceId = LOCAL_MESSAGES.primaryReferenceId ?? '';
    if (Object.keys(required).length > 0) {
      save.reset();
      setLocal(required);
      return;
    }

    const refs = secondary
      ? [{ id: primary?.id ?? '' }, { id: secondary.id }]
      : [{ id: primary?.id ?? '' }];

    const candidate = {
      speciesId,
      traitId: trait?.id ?? '',
      value: valueType === 'quantitative' ? { numeric: Number(numeric) } : { levelId },
      sources: { references: refs },
      rawValue: rawValue.trim() || undefined,
      note: note.trim() || undefined,
    };
    const parsed = createRecordBodySchema.safeParse(candidate);
    if (!parsed.success) {
      save.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        next[path] = LOCAL_MESSAGES[path] ?? LOCAL_MESSAGES[String(issue.path[0])] ?? issue.message;
      }
      setLocal(next);
      return;
    }
    setLocal({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog open title="Add value" onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {initialTrait ? (
          <div className="flex flex-col gap-1">
            <p className="text-body text-canopy-900">
              <span className="text-mist-500">Trait: </span>
              {humaniseKey(initialTrait.key)}
              {unit ? <span className="text-mist-500"> · {unit}</span> : null}
            </p>
            {errors.traitId ? <p className="text-label text-red-700">{errors.traitId}</p> : null}
          </div>
        ) : (
          <Field
            id={ids.trait}
            label="Trait"
            error={errors.traitId}
            hint={dictionary.isError ? 'Could not load the dictionary.' : undefined}
          >
            <Combobox
              id={ids.trait}
              value={trait}
              onChange={(next) => {
                setTrait(next);
                setLevelId('');
                setNumeric('');
              }}
              search={searchTraits}
              searchKey={`traits:${dictionary.dataUpdatedAt}`}
              listLabel="Trait suggestions"
              placeholder="Type to search traits"
              invalid={Boolean(errors.traitId)}
            />
          </Field>
        )}
        {valueType === 'categorical' ? (
          <Field id={ids.level} label="Level" error={errors['value.levelId'] ?? errors.value}>
            <Select
              id={ids.level}
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
              invalid={Boolean(errors['value.levelId'] ?? errors.value)}
            >
              <option value="">Choose a level</option>
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.key}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {valueType === 'quantitative' ? (
          <Field
            id={ids.numeric}
            label={unit ? `Number (${unit})` : 'Number'}
            error={errors['value.numeric'] ?? errors.value}
          >
            <div className="flex items-center gap-2">
              <Input
                id={ids.numeric}
                type="number"
                step="any"
                inputMode="decimal"
                value={numeric}
                onChange={(e) => setNumeric(e.target.value)}
                invalid={Boolean(errors['value.numeric'] ?? errors.value)}
              />
              {unit ? <span className="text-meta text-mist-500">{unit}</span> : null}
            </div>
          </Field>
        ) : null}
        <Field
          id={ids.primary}
          label="Primary reference"
          error={errors.primaryReferenceId}
          hint={canCreateReference ? 'Type a citation key; create it if it is missing.' : undefined}
        >
          <Combobox
            id={ids.primary}
            value={primary}
            onChange={setPrimary}
            search={searchRefs}
            searchKey="references"
            minChars={2}
            listLabel="Reference suggestions"
            placeholder="Type to search references"
            onCreate={canCreateReference ? createRef : undefined}
            createErrorMessage={referenceErrorMessage}
            invalid={Boolean(errors.primaryReferenceId)}
          />
        </Field>
        <Field
          id={ids.secondary}
          label="Secondary reference (optional)"
          error={errors.secondaryReferenceId}
        >
          <Combobox
            id={ids.secondary}
            value={secondary}
            onChange={setSecondary}
            search={searchRefs}
            searchKey="references"
            minChars={2}
            listLabel="Secondary reference suggestions"
            placeholder="Type to search references"
          />
        </Field>
        <Field id={ids.raw} label="As written in the source (optional)" error={errors.rawValue}>
          <Input
            id={ids.raw}
            value={rawValue}
            maxLength={2000}
            onChange={(e) => setRawValue(e.target.value)}
          />
        </Field>
        <Field
          id={ids.note}
          label="Note (optional)"
          error={errors.note}
          hint="Where in the source the value is (page, table)."
        >
          <Textarea
            id={ids.note}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {save.isError ? (
          <Alert tone="error">
            {addValueErrorMessage(save.error)}
            {duplicateId ? (
              <>
                {' '}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => onOpenRecord(duplicateId)}
                >
                  Open existing record
                </button>
              </>
            ) : null}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            Add record
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
