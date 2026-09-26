import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateRecordBody,
  type CreateRecordsResult,
  createRecordBodySchema,
  type RecordIntent,
  type RecordItem,
  type TraitRef,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { createRecords } from '../../api/curation.ts';
import {
  datasetKeys,
  fetchDictionary,
  fetchRecords,
  fetchSpeciesTraits,
} from '../../api/dataset.ts';
import { helpHref } from '../../content/help/href.ts';
import { categoriesWithActiveTraits, traitDescription } from '../../lib/dictionary.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { Alert, Button, Dialog, Field, HelpTip, Select } from '../ui/index.ts';
import { contributionErrorMessage, SOURCES_NOT_READY } from './errors.ts';
import { EMPTY_SOURCES, SourcesField, type SourcesValue, sourcesToBody } from './SourcesField.tsx';
import {
  EMPTY_QUANTITATIVE,
  type QuantitativeText,
  quantitativeToBody,
  ValueField,
} from './ValueField.tsx';

const TITLE = 'Add entries for another trait';
// The API's page ceiling (RFC-11 R6): every value one species holds for one
// trait, in practice.
const EXISTING_LIMIT = 200;
// A hint, not the rule: the API validates the quantitative value (R-5).
const ANCHORS = ['single', 'min', 'max', 'mean'] as const;
const MESSAGES = {
  categoryKey: 'Choose a broad trait category.',
  traitId: 'Choose a trait.',
  respondsTo: 'Choose the value you respond to.',
  levelIds: 'Choose at least one level.',
  quantitative: 'Enter at least one of single, min, max or mean.',
  value: 'Check the value.',
};
const EXISTING_NOTE =
  'This species already has records for this trait. Say first what your value means, and which value it answers.';
const LEGEND = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';
/** RFC-70 R10: a categorical contest that leaves no level of E unchecked. */
const NOTHING_CONTESTED = 'A contest must contest at least one level; this is a complement';
// The paths a control of this form shows its error under; any other detail
// (`contestedLevelIds`, `intent`) has no field, so the alert says it verbatim.
const OWNED_PATH = /^(value|sources|traitId|categoryKey|respondsTo)(\.|$)/;

// ponytail: stand-in for Task 2's `recordValueLabel` (`../dataset/RecordTable.tsx`,
// another lane); delete it and import that one when the lanes meet.
function recordValueLabel(record: RecordItem): string {
  if (record.level) return record.level.key;
  const n = record.quantitative?.single ?? record.quantitative?.mean;
  if (n === undefined || n === null) return record.valueText || '(empty)';
  return `${formatNumber(n)}${record.trait.unit ? ` ${record.trait.unit}` : ''}`;
}

/** The two things a new value can mean about the value it answers (R-8). */
const INTENTS: ReadonlyArray<{ value: RecordIntent; label: string; example: string }> = [
  {
    value: 'contest',
    label: 'Contest — The existing value is wrong; mine should replace it.',
    example: 'Existing: biotic; yours: abiotic — the mode is abiotic, not biotic.',
  },
  {
    value: 'complement',
    label: 'Complement — The existing value is also correct; I am adding another observation.',
    example: 'Existing: biotic; yours: abiotic — it can be both.',
  },
];

/** The trait as the select reads it: its name, and its unit when it has one. */
function traitLabel(trait: Pick<TraitRef, 'key' | 'unit'>): string {
  return trait.unit ? `${humaniseKey(trait.key)} (${trait.unit})` : humaniseKey(trait.key);
}

/**
 * What an entry answers, when the caller already knows. `intent` is set by
 * 👎 only (`contest`); ＋ leaves it out, so the user still chooses (RFC-70
 * R9). `levelId` is, for a categorical contest, the level left unchecked,
 * and otherwise the level whose record a complement responds to; `recordId`
 * is the responded record (a quantitative row, or the record drawer).
 * @rfc RFC-70 R1, R9
 */
export interface RespondTo {
  intent?: RecordIntent;
  levelId?: string;
  recordId?: string;
}

// The values a complement (or a quantitative contest) can answer: each level
// once for a categorical trait (any record of the level will do), each record for a
// quantitative one.
function respondableTargets(
  records: RecordItem[],
  categorical: boolean,
): { value: string; label: string }[] {
  if (!categorical) {
    return records.map((record) => ({
      value: record.id,
      label: `${record.recordCode} · ${recordValueLabel(record)}`,
    }));
  }
  const levels = new Map<string, string>();
  for (const record of records) {
    if (record.level && !levels.has(record.level.id)) levels.set(record.level.id, record.level.key);
  }
  return [...levels].map(([value, label]) => ({ value, label }));
}

function CodeButton({ id, code, onOpen }: { id: string; code: string; onOpen(id: string): void }) {
  return (
    <button
      type="button"
      className="font-semibold text-canopy-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      onClick={() => onOpen(id)}
    >
      {code}
    </button>
  );
}

/** @rfc RFC-70 R1, R3 */
export interface AddEntriesDialogProps {
  speciesId: string;
  /** The trait a card, a row or the drawer opened the dialog for; the selects are then fixed. */
  initialTrait?: TraitRef | null;
  /** The answer 👎 / ＋ / the drawer already gave; see {@link RespondTo}. */
  respondTo?: RespondTo | null;
  onClose(): void;
  /** The API's answer, once every stale query is invalidated — only when nothing matched an existing record. */
  onCreated(result: CreateRecordsResult): void;
  onOpenRecord(id: string): void;
}

/**
 * The one entry form of the species page (spec §2): the broad category and
 * the trait within it (fixed and read as one line when a card, a row or the
 * drawer opened it), then — when the species already has records for the
 * trait — a required first step: **Contest** or **Complement**, and, for a
 * complement or a quantitative contest, which existing value it answers
 * ("Responding to"). Every other field and the submit button stay disabled
 * until that is answered (item 2.1), and while the existing records or E
 * load. Then the value: one checkbox per level, several allowed (R-3), or the
 * six quantitative numbers (R-5); and the sources: DOIs, ISBNs with their
 * citation, or none for a personal observation (R-4, R-16).
 *
 * A categorical contest responds to no record (RFC-70 R1): choosing it checks
 * every level of E — the active levels with visible records, from the
 * species' summary — but the one whose 👎 opened the dialog, and it sends the
 * unchecked ones, E \ S, as `contestedLevelIds`. It cannot be sent when E \ S
 * is empty. Every categorical entry with a non-empty E shows what it will do
 * per level ("Validate red · Contest blue · Add green") behind a required
 * confirmation, asked again after any change and after a 400 on
 * `contestedLevelIds`, which also reloads the levels (RFC-70 R10).
 *
 * For a complement on a categorical trait the record sent as
 * `respondsToRecordId` is the one the drawer opened when it has the chosen
 * level, else the first loaded record of that level. The API decides
 * duplicates (R-7): an answer carrying `validated` or `duplicates`, or one
 * that created nothing (a contest that only contested), keeps the dialog
 * open to say what happened, naming each record ID as a button that opens
 * it; any other answer goes to `onCreated`.
 * @rfc RFC-13 R6, R10, R11
 * @rfc RFC-65 R1
 * @rfc RFC-70 R1, R2, R3, R9, R10
 */
export function AddEntriesDialog({
  speciesId,
  initialTrait = null,
  respondTo = null,
  onClose,
  onCreated,
  onOpenRecord,
}: AddEntriesDialogProps) {
  const me = useMe();
  const baseId = useId();
  const ids = {
    category: `${baseId}-category`,
    trait: `${baseId}-trait`,
    target: `${baseId}-target`,
    value: `${baseId}-value`,
  };
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const categories = categoriesWithActiveTraits(dictionary.data ?? []);

  const [categoryKey, setCategoryKey] = useState('');
  const [traitId, setTraitId] = useState(initialTrait?.id ?? '');
  const [intent, setIntent] = useState<RecordIntent | null>(respondTo?.intent ?? null);
  const [target, setTarget] = useState(() =>
    initialTrait?.valueType === 'categorical'
      ? (respondTo?.levelId ?? '')
      : (respondTo?.recordId ?? ''),
  );
  // `null` until the user ticks a level: a contest then starts from E minus the
  // level whose 👎 opened the dialog (RFC-70 R10), anything else from none.
  const [pickedLevels, setPickedLevels] = useState<string[] | null>(null);
  const [quantitative, setQuantitative] = useState<QuantitativeText>(EMPTY_QUANTITATIVE);
  const [sources, setSources] = useState<SourcesValue>(EMPTY_SOURCES);
  // A blank field is a personal observation, which is ready as it stands.
  const [sourcesReady, setSourcesReady] = useState(true);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState<CreateRecordsResult | null>(null);
  // The summary the user confirmed. Any change to the levels or the intent
  // asks again (RFC-70 R10), and so does a new E, which changes the text.
  const [confirmedText, setConfirmedText] = useState<string | null>(null);
  // The level keys the last categorical contest contested, for the result.
  const [sentContest, setSentContest] = useState('');
  const queryClient = useQueryClient();

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
  const title = initialTrait ? `Add entries for ${traitLabel(initialTrait)}` : TITLE;

  const existing = useQuery({
    queryKey: datasetKeys.records({ speciesId, traitId, limit: EXISTING_LIMIT }),
    queryFn: () => fetchRecords({ speciesId, traitId, limit: EXISTING_LIMIT }),
    enabled: traitId !== '',
  });
  const records = existing.data?.data ?? [];
  const needsIntent = records.length > 0;
  const categorical = valueType === 'categorical';
  const categoricalContest = categorical && needsIntent && intent === 'contest';

  // E (RFC-63 R14): the active levels with visible records, read off the
  // species' summary — which also lists inactive ones, hence the filter.
  const summary = useQuery({
    queryKey: datasetKeys.speciesTraits(speciesId, false),
    queryFn: () => fetchSpeciesTraits(speciesId),
    enabled: categorical,
  });
  const activeIds = new Set(activeLevels.map((level) => level.id));
  const withRecords = new Set(
    (summary.data?.flatMap((c) => c.traits).find((t) => t.trait.id === traitId)?.levels ?? []).map(
      (level) => level.levelId,
    ),
  );
  const inE = (id: string) => withRecords.has(id) && activeIds.has(id);
  const E = activeLevels.filter((level) => inE(level.id)).map((level) => level.id);
  const levelIds =
    pickedLevels ?? (categoricalContest ? E.filter((id) => id !== respondTo?.levelId) : []);
  const chosen = new Set(levelIds);
  const contestedLevelIds = E.filter((id) => !chosen.has(id));
  const keysOf = (keep: (id: string) => boolean) =>
    activeLevels
      .filter((level) => keep(level.id))
      .map((level) => level.key)
      .join(', ');
  const confirmText =
    categorical && E.length > 0 && levelIds.length > 0
      ? [
          ['Validate', keysOf((id) => chosen.has(id) && inE(id))],
          ['Contest', categoricalContest ? keysOf((id) => !chosen.has(id) && inE(id)) : ''],
          ['Add', keysOf((id) => chosen.has(id) && !inE(id))],
        ]
          .filter(([, keys]) => keys !== '')
          .map(([verb, keys]) => `${verb} ${keys}`)
          .join(' · ')
      : '';
  const confirmed = confirmText !== '' && confirmedText === confirmText;
  const nothingContested =
    categoricalContest && summary.isSuccess && contestedLevelIds.length === 0;

  const loading = existing.isPending || (categorical && summary.isPending);
  const failed = existing.isError || (categorical && summary.isError);
  const locked =
    traitId !== '' &&
    (loading ||
      failed ||
      (needsIntent && (intent === null || (!categoricalContest && target === ''))));
  const blocked = locked || nothingContested || (confirmText !== '' && !confirmed);
  const targets = respondableTargets(records, categorical);

  const save = useRecordWrite<CreateRecordBody, CreateRecordsResult>({
    write: createRecords,
    speciesId,
    // A contest that only contested creates nothing; it is said, not
    // closed on silently.
    onInvalidated: (result) => {
      const matched = result.validated.length > 0 || result.duplicates.length > 0;
      if (matched || (intent === 'contest' && result.created.length === 0)) setAnswered(result);
      else onCreated(result);
    },
  });

  const serverErrors = fieldErrors(save.error);
  const errors: Record<string, string | undefined> = { ...serverErrors, ...local };
  const valueErrors: Record<string, string> = {};
  const sourceErrors: Record<string, string> = {};
  for (const [path, message] of Object.entries(errors)) {
    if (message === undefined) continue;
    if (path === 'value' || path.startsWith('value.')) valueErrors[path] = message;
    if (path === 'sources' || path.startsWith('sources.')) sourceErrors[path] = message;
  }
  const unowned = Object.entries(serverErrors).find(([path]) => !OWNED_PATH.test(path))?.[1];
  const alertMessage =
    local.form ?? (save.isError ? (unowned ?? contributionErrorMessage(save.error)) : undefined);

  // A new trait (or category) starts the answer and the value over: they
  // belonged to the old one.
  function resetAnswer() {
    setIntent(null);
    setTarget('');
    setPickedLevels(null);
    setQuantitative(EMPTY_QUANTITATIVE);
  }
  function chooseCategory(key: string) {
    setCategoryKey(key);
    setTraitId('');
    resetAnswer();
    setLocal(({ categoryKey: _categoryKey, traitId: _traitId, ...rest }) => rest);
  }
  function chooseTrait(id: string) {
    setTraitId(id);
    resetAnswer();
    setLocal(({ traitId: _traitId, ...rest }) => rest);
  }
  // Contest starts the levels over from E (RFC-70 R10); Complement keeps them.
  function chooseIntent(next: RecordIntent) {
    setIntent(next);
    setPickedLevels(next === 'contest' ? null : levelIds);
    setConfirmedText(null);
    save.reset();
  }
  function chooseTarget(value: string) {
    setTarget(value);
    setLocal(({ respondsTo: _respondsTo, ...rest }) => rest);
  }
  function changeLevels(next: string[]) {
    setPickedLevels(next);
    setConfirmedText(null);
    setLocal(({ 'value.levelIds': _levelIds, value: _value, ...rest }) => rest);
  }
  function changeQuantitative(next: QuantitativeText) {
    setQuantitative(next);
    setLocal(({ 'value.quantitative': _quantitative, value: _value, ...rest }) => rest);
  }

  function respondsToRecordId(): string | undefined {
    if (valueType !== 'categorical') return target === '' ? undefined : target;
    if (respondTo?.recordId && respondTo.levelId === target) return respondTo.recordId;
    return records.find((record) => record.level?.id === target)?.id;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
    const required: Record<string, string> = {};
    if (!initialTrait && categoryKey === '') required.categoryKey = MESSAGES.categoryKey;
    if (traitId === '') required.traitId = MESSAGES.traitId;
    if (valueType === 'categorical' && levelIds.length === 0) {
      required['value.levelIds'] = MESSAGES.levelIds;
    }
    if (valueType === 'quantitative' && ANCHORS.every((key) => quantitative[key].trim() === '')) {
      required['value.quantitative'] = MESSAGES.quantitative;
    }
    const respondsTo = needsIntent && !categoricalContest ? respondsToRecordId() : undefined;
    if (needsIntent && !categoricalContest && respondsTo === undefined) {
      required.respondsTo = MESSAGES.respondsTo;
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
          ? { quantitative: quantitativeToBody(quantitative) }
          : { levelIds },
      sources: sourcesToBody(sources),
      ...(categoricalContest ? { intent, contestedLevelIds } : {}),
      ...(needsIntent && !categoricalContest ? { intent, respondsToRecordId: respondsTo } : {}),
    };
    const parsed = createRecordBodySchema.safeParse(candidate);
    if (!parsed.success) {
      save.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        next[path] = path === 'value' ? MESSAGES.value : issue.message;
      }
      setLocal(next);
      return;
    }
    setLocal({});
    setSentContest(categoricalContest ? keysOf((id) => contestedLevelIds.includes(id)) : '');
    save.mutate(parsed.data, {
      // The levels changed meanwhile (RFC-70 R10): reload them and ask again.
      onError: (error) => {
        if (fieldErrors(error).contestedLevelIds === undefined) return;
        setConfirmedText(null);
        void queryClient.invalidateQueries({
          queryKey: datasetKeys.speciesTraits(speciesId, false),
        });
        void queryClient.invalidateQueries({ queryKey: datasetKeys.dictionary() });
      },
    });
  }

  if (answered) {
    return (
      <Dialog open title={title} onClose={onClose}>
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2 text-body text-canopy-900">
            {answered.created.map((record) => (
              <li key={`created-${record.id}`}>
                <CodeButton id={record.id} code={record.recordCode} onOpen={onOpenRecord} /> was
                added.
              </li>
            ))}
            {answered.validated.map((match) => (
              <li key={`validated-${match.recordId}`}>
                <CodeButton id={match.recordId} code={match.recordCode} onOpen={onOpenRecord} />{' '}
                matches an existing record — counted as your validation.
              </li>
            ))}
            {answered.duplicates.map((match) => (
              <li key={`duplicate-${match.recordId}`}>
                <CodeButton id={match.recordId} code={match.recordCode} onOpen={onOpenRecord} /> is
                already your own record — nothing was added.
              </li>
            ))}
            {sentContest ? <li>{`Your contest of ${sentContest} was recorded.`}</li> : null}
          </ul>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </Dialog>
    );
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

        {traitId !== '' && existing.isPending ? (
          <p className="text-meta text-mist-500">Checking the existing records…</p>
        ) : null}
        {failed ? (
          <p className="text-meta text-red-700">
            Could not load the existing records. Reload the page.
          </p>
        ) : null}

        {needsIntent ? (
          <fieldset className="flex flex-col gap-3">
            <legend className={LEGEND}>What does your value mean?</legend>
            <p className="text-meta text-mist-500">{EXISTING_NOTE}</p>
            {INTENTS.map((option) => {
              const exampleId = `${baseId}-${option.value}-example`;
              return (
                <div key={option.value} className="flex flex-col gap-0.5">
                  <label className="flex items-start gap-2 text-body text-canopy-950">
                    <input
                      type="radio"
                      name={`${baseId}-intent`}
                      value={option.value}
                      checked={intent === option.value}
                      aria-describedby={exampleId}
                      onChange={() => chooseIntent(option.value)}
                      className="mt-1 size-4 accent-canopy-700"
                    />
                    <span>{option.label}</span>
                  </label>
                  <p id={exampleId} className="pl-6 text-meta text-mist-500">
                    {option.example}
                  </p>
                </div>
              );
            })}
            {categoricalContest ? null : (
              <Field id={ids.target} label="Responding to" error={errors.respondsTo}>
                <Select
                  id={ids.target}
                  value={target}
                  onChange={(e) => chooseTarget(e.target.value)}
                  invalid={Boolean(errors.respondsTo)}
                >
                  <option value="">Choose the value you respond to</option>
                  {targets.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </fieldset>
        ) : null}

        <fieldset disabled={locked} className="flex flex-col gap-4">
          <legend className="sr-only">Your record</legend>
          {valueType ? (
            <ValueField
              trait={{ valueType, unit, levels }}
              levelIds={levelIds}
              quantitative={quantitative}
              onLevels={changeLevels}
              onQuantitative={changeQuantitative}
              errors={valueErrors}
              idPrefix={ids.value}
            />
          ) : null}
          {valueType === 'categorical' && activeLevels.length === 0 && !dictionary.isPending ? (
            <p className="text-meta text-red-700">
              {dictionary.isError
                ? 'Could not load the levels. Reload the page.'
                : 'This trait has no level to choose from.'}
            </p>
          ) : null}
          {confirmText ? (
            <label className="flex items-start gap-2 text-body text-canopy-950">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmedText(event.target.checked ? confirmText : null)}
                className="mt-1 size-4 accent-canopy-700"
              />
              {`Confirm: ${confirmText}`}
            </label>
          ) : null}
          <SourcesField
            value={sources}
            onChange={setSources}
            errors={sourceErrors}
            onValidity={setSourcesReady}
          />
          <p className="text-meta text-mist-500">Recorded as {me.user.name}</p>
        </fieldset>

        {nothingContested ? <Alert tone="info">{NOTHING_CONTESTED}</Alert> : null}
        {alertMessage ? <Alert tone="error">{alertMessage}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} disabled={blocked}>
            Add record(s)
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
