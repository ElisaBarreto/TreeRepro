import { useQuery } from '@tanstack/react-query';
import {
  type CreateRecordBody,
  type CreateRecordsResult,
  createRecordBodySchema,
  type TraitRef,
} from '@treerepro/contracts';
import { type FormEvent, Fragment, type ReactNode, useId, useState } from 'react';
import { createRecords } from '../../api/curation.ts';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { helpHref } from '../../content/help/href.ts';
import { categoriesWithActiveTraits, traitDescription } from '../../lib/dictionary.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { Alert, Button, Dialog, Field, HelpTip, Select } from '../ui/index.ts';
import { contributionErrorMessage, SOURCES_NOT_READY } from './errors.ts';
import { SourcesField, type SourcesValue, sourcesToBody } from './SourcesField.tsx';
import { ValueField } from './ValueField.tsx';

const TITLE = 'Add entries for another trait';
const LOCAL_MESSAGES: Record<string, string> = {
  categoryKey: 'Choose a broad trait category.',
  traitId: 'Choose a trait.',
  value: 'Enter a value.',
  'value.levelId': 'Choose a level.',
  'value.numeric': 'Enter a number.',
};

/** The trait as the select reads it: its name, and its unit when it has one. */
function traitLabel(trait: Pick<TraitRef, 'key' | 'unit'>): string {
  return trait.unit ? `${humaniseKey(trait.key)} (${trait.unit})` : humaniseKey(trait.key);
}

/**
 * The link the contributor follows to a record the API named: one that
 * already carried the claim, or one the entry validated.
 */
function existingRecordLinks(ids: string[], onOpen: (id: string) => void): ReactNode {
  return ids.map((id) => (
    <Fragment key={id}>
      {' '}
      <button type="button" className="font-semibold underline" onClick={() => onOpen(id)}>
        Open existing record
      </button>
    </Fragment>
  ));
}

/**
 * What a 201 that matched existing records tells the contributor (RFC-70 R3):
 * what it added, which claims already existed, which it counted as a
 * validation.
 */
function partialSentence(result: CreateRecordsResult): string {
  const created = result.created.length;
  return [
    created > 0 ? `Added ${created} ${created === 1 ? 'record' : 'records'}.` : null,
    result.duplicates.length > 0 ? 'One of these claims already existed.' : null,
    result.validated.length > 0 ? 'Matches an existing record — counted as your validation.' : null,
  ]
    .filter((sentence) => sentence !== null)
    .join(' ');
}

export interface AddEntriesDialogProps {
  speciesId: string;
  /** The trait a card opened the dialog for; both selects are then fixed. */
  initialTrait?: TraitRef | null;
  onClose(): void;
  /**
   * The API's answer, once every stale query is invalidated — only when
   * `duplicates` and `validated` are empty; an answer that matched existing
   * records keeps the dialog open instead (`partial` below) and never calls
   * this.
   */
  onCreated(result: CreateRecordsResult): void;
  onOpenRecord(id: string): void;
}

/**
 * What a contributor decides when they record a trait of a species (spec
 * §7.3): the broad category, the trait within it — the select is filled from
 * the category and offers its active traits only, with a `?` carrying the
 * dictionary's description — the value the trait's type takes, and where the
 * claim comes from. Changing the category drops the trait and the value with
 * it: they belonged to the old category. Opened from a trait card, both are
 * fixed and read as one line instead, and the title names the trait — the
 * constant title asks the contributor to choose one, which a fixed trait
 * would turn into a contradiction.
 *
 * The API matches the entry against the visible records (RFC-70 R3), so an
 * answer is not always plainly a creation: `duplicates` names the claims
 * that already existed and `validated` the records the entry counted as the
 * contributor's validation, and the dialog then stays open to say so with a
 * link to each instead of closing as if everything had been created.
 * @rfc RFC-13 R6
 * @rfc RFC-65 R1
 * @rfc RFC-70 R1, R3
 */
export function AddEntriesDialog({
  speciesId,
  initialTrait = null,
  onClose,
  onCreated,
  onOpenRecord,
}: AddEntriesDialogProps) {
  const me = useMe();
  const ids = { category: useId(), trait: useId(), level: useId(), numeric: useId() };
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const categories = categoriesWithActiveTraits(dictionary.data ?? []);

  const [categoryKey, setCategoryKey] = useState('');
  const [traitId, setTraitId] = useState(initialTrait?.id ?? '');
  const [levelId, setLevelId] = useState('');
  const [numeric, setNumeric] = useState('');
  const [sources, setSources] = useState<SourcesValue>({ dois: [''] });
  // A blank field is a personal observation, which is ready as it stands.
  const [sourcesReady, setSourcesReady] = useState(true);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [partial, setPartial] = useState<CreateRecordsResult | null>(null);

  // A fixed trait brings its own category: the one it sits in.
  const category = initialTrait
    ? categories.find((c) => c.traits.some((t) => t.id === initialTrait.id))
    : categories.find((c) => c.key === categoryKey);
  const traits = category?.traits ?? [];
  const trait = traits.find((t) => t.id === traitId);
  const levels = trait?.levels ?? [];
  const activeLevels = levels.filter((level) => level.active);
  const valueType = trait?.valueType ?? initialTrait?.valueType;
  const unit = trait?.unit ?? initialTrait?.unit ?? null;
  const description = traitDescription(dictionary.data, traitId);
  // The constant title only fits the header button's dialog, which asks the
  // contributor to choose a trait; opened with one already fixed, the same
  // words would read as a contradiction, so the title names it instead.
  const title = initialTrait ? `Add entries for ${traitLabel(initialTrait)}` : TITLE;

  const save = useRecordWrite<CreateRecordBody, CreateRecordsResult>({
    write: createRecords,
    speciesId,
    onInvalidated: (result) => {
      if (result.duplicates.length > 0 || result.validated.length > 0) setPartial(result);
      else onCreated(result);
    },
  });

  const errors: Record<string, string | undefined> = { ...fieldErrors(save.error), ...local };
  // `ValueField` and `SourcesField` read the paths they own; both take the
  // messages that are there, so an absent one stays absent.
  const valueErrors: Record<string, string> = {};
  const sourceErrors: Record<string, string> = {};
  for (const [path, message] of Object.entries(errors)) {
    if (message === undefined) continue;
    if (path === 'value' || path.startsWith('value.')) valueErrors[path] = message;
    if (path === 'sources' || path.startsWith('sources.')) sourceErrors[path] = message;
  }
  const alertMessage =
    local.form ?? (save.isError ? contributionErrorMessage(save.error) : undefined);

  // Clears only the messages this choice resolves: a fresh choice earns a
  // fresh submit's worth of checks, not a wipe of every other field's error.
  function chooseCategory(key: string) {
    setCategoryKey(key);
    setTraitId('');
    setLevelId('');
    setNumeric('');
    setLocal(({ categoryKey: _categoryKey, traitId: _traitId, ...rest }) => rest);
  }
  function chooseTrait(id: string) {
    setTraitId(id);
    setLevelId('');
    setNumeric('');
    setLocal(({ traitId: _traitId, ...rest }) => rest);
  }
  // The value control shows `value.<branch>` or, for an issue the union
  // reported at its own path, `value`; supplying a value answers both, so
  // both go — leaving either would keep "Enter a number." and its red ring
  // under a field that now holds one, until the next submit.
  function chooseLevel(id: string) {
    setLevelId(id);
    setLocal(({ 'value.levelId': _levelId, value: _value, ...rest }) => rest);
  }
  function changeNumeric(text: string) {
    setNumeric(text);
    setLocal(({ 'value.numeric': _numeric, value: _value, ...rest }) => rest);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPartial(null);
    // Local, per-required-field checks first: `createRecordBodySchema.value`
    // is a plain `z.union`, so a bad number (`NaN`) fails both branches and
    // Zod reports one issue at the union's own path (`value`), never reaching
    // the nested `value.numeric`/`value.levelId` paths the messages key on.
    // Only once every required field is present does the schema parse run, to
    // catch what these checks don't (out-of-range numbers, a malformed DOI).
    const required: Record<string, string> = {};
    if (!initialTrait && categoryKey === '')
      required.categoryKey = LOCAL_MESSAGES.categoryKey ?? '';
    if (traitId === '') required.traitId = LOCAL_MESSAGES.traitId ?? '';
    if (valueType === 'categorical' && levelId === '') {
      required['value.levelId'] = LOCAL_MESSAGES['value.levelId'] ?? '';
    }
    if (valueType === 'quantitative' && (numeric.trim() === '' || Number.isNaN(Number(numeric)))) {
      required['value.numeric'] = LOCAL_MESSAGES['value.numeric'] ?? '';
    }
    if (!sourcesReady) required.form = SOURCES_NOT_READY;
    if (Object.keys(required).length > 0) {
      save.reset();
      setLocal(required);
      return;
    }

    const candidate = {
      speciesId,
      traitId,
      value:
        valueType === 'quantitative'
          ? { quantitative: { single: Number(numeric) } }
          : { levelIds: [levelId] },
      sources: sourcesToBody(sources),
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
    <Dialog open title={title} onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {initialTrait ? (
          <div className="flex flex-col gap-1">
            <p className="text-body text-canopy-900">
              <span className="text-mist-500">Trait: </span>
              {[category?.label, traitLabel({ key: initialTrait.key, unit })]
                .filter((part) => part !== undefined)
                .join(' › ')}{' '}
              {description ? (
                <HelpTip
                  label="What does this trait mean?"
                  learnMore={helpHref('vocabulary', 'descriptions')}
                >
                  {description}
                </HelpTip>
              ) : null}
            </p>
            {errors.traitId ? <p className="text-label text-red-700">{errors.traitId}</p> : null}
          </div>
        ) : (
          <>
            <Field
              id={ids.category}
              label="Broad trait category"
              error={errors.categoryKey}
              hint={dictionary.isError ? 'Could not load the dictionary.' : undefined}
            >
              <Select
                id={ids.category}
                value={categoryKey}
                onChange={(e) => chooseCategory(e.target.value)}
                invalid={Boolean(errors.categoryKey)}
              >
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id={ids.trait}
              label="Trait"
              error={errors.traitId}
              trailing={
                description ? (
                  <HelpTip
                    label="What does this trait mean?"
                    learnMore={helpHref('vocabulary', 'descriptions')}
                  >
                    {description}
                  </HelpTip>
                ) : undefined
              }
            >
              <Select
                id={ids.trait}
                value={traitId}
                disabled={category === undefined}
                onChange={(e) => chooseTrait(e.target.value)}
                invalid={Boolean(errors.traitId)}
              >
                <option value="">Choose a trait</option>
                {traits.map((t) => (
                  <option key={t.id} value={t.id}>
                    {traitLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        {valueType ? (
          <ValueField
            trait={{ valueType, unit, levels }}
            levelId={levelId}
            numeric={numeric}
            onLevel={chooseLevel}
            onNumeric={changeNumeric}
            errors={valueErrors}
            ids={{ level: ids.level, numeric: ids.numeric }}
          />
        ) : null}
        {valueType === 'categorical' && activeLevels.length === 0 && !dictionary.isPending ? (
          // An empty select needs a reason. A fixed trait renders no category
          // field, so the hint under it never reaches this case: the trait may
          // be inactive, outside the viewer's visibility, or the dictionary may
          // not have loaded at all — and there is nothing this form can offer.
          <p className="text-meta text-red-700">
            {dictionary.isError
              ? 'Could not load the levels. Reload the page.'
              : 'This trait has no level to choose from.'}
          </p>
        ) : null}
        <SourcesField
          value={sources}
          onChange={setSources}
          errors={sourceErrors}
          onValidity={setSourcesReady}
        />
        <p className="text-meta text-mist-500">Recorded as {me.user.name}</p>
        {alertMessage ? <Alert tone="error">{alertMessage}</Alert> : null}
        {partial ? (
          <Alert tone="info">
            {partialSentence(partial)}
            {existingRecordLinks(
              [...partial.duplicates, ...partial.validated].map((ref) => ref.recordId),
              onOpenRecord,
            )}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            Add record(s)
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
