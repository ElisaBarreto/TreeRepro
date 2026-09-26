import { useQuery } from '@tanstack/react-query';
import {
  type CreateRecordBody,
  type CreateRecordsResult,
  createRecordBodySchema,
  type RecordDetail,
  type RecordIntent,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { createRecords } from '../../api/curation.ts';
import { datasetKeys, fetchDictionary, fetchSpeciesTraits } from '../../api/dataset.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { useMe } from '../../lib/session.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
import { Alert, Button, Dialog } from '../ui/index.ts';
import { contributionErrorMessage, SOURCES_NOT_READY } from './errors.ts';
import { SourcesField, type SourcesValue, sourcesToBody } from './SourcesField.tsx';
import { ValueField } from './ValueField.tsx';

/** The two things a new value can mean about the record it answers (RFC-70 R1). */
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

const LOCAL_MESSAGES: Record<string, string> = {
  value: 'Enter a value.',
  'value.levelId': 'Choose a level.',
  'value.numeric': 'Enter a number.',
};

const VALUE_PATHS = ['value', 'value.levelIds.0', 'value.levelId', 'value.numeric'] as const;

/** RFC-70 R10: a categorical contest that leaves no level of E unchosen. */
const NOTHING_CONTESTED = 'A contest must contest at least one level; this is a complement';

// A validation detail that lands under a field is the message; the alert
// above the buttons would only repeat it in vaguer words. The contest rule
// ("A contest carries a different value", RFC-70 R2) arrives at `value`, so
// it belongs under the value control.
function boundToAField(errors: Record<string, string>): boolean {
  return Object.keys(errors).some(
    (path) => path === 'value' || path.startsWith('value.') || path.startsWith('sources'),
  );
}

/**
 * The alert's sentence for a refusal the API sent: a validation detail this
 * form has no field for — `intent` or `respondsToRecordId`, which it sets
 * itself — is shown in the API's own words, since "Check the highlighted
 * fields" would highlight nothing. Everything else reads through the
 * contribution map. A refusal the form raised itself is shown as it stands.
 */
function apiAlertMessage(error: unknown, errors: Record<string, string>): string {
  return Object.values(errors)[0] ?? contributionErrorMessage(error);
}

/**
 * The two steps of RFC-70 R1 in one dialog: first what the value means about
 * the record it answers — it *contests* it (the existing value is wrong) or
 * *complements* it (both hold) — and only then the record itself, whose
 * fields stay disabled until that is answered, because the same value means
 * two different things and the API's side effects differ (a contest is
 * stored and marks what it contests, RFC-70 R3). Changing the answer keeps what was
 * already typed: only the refusal the last attempt earned is dropped, since
 * "a contest carries a different value" stops applying the moment the intent
 * becomes a complement.
 *
 * The value comes from the record's own trait, its levels from the shared
 * dictionary query; the sources from {@link SourcesField}, so no DOI at all
 * means the contributor's personal observation. A categorical contest
 * responds to no record (RFC-70 R1): it names the levels it contests, E \ S
 * — E the active levels with visible records, read off the species' trait
 * summary, S the chosen level — and cannot be sent when that is empty
 * (RFC-70 R10). A 201 that matched existing records is not a failure (RFC-70
 * R3): the claims that already existed and the records counted as the
 * contributor's validation are named, with a link each, before the record
 * that was created is handed up.
 * @rfc RFC-13 R6, R10
 * @rfc RFC-70 R1, R2, R3, R10
 */
export function ContestDialog({
  record,
  onClose,
  onCreated,
  onOpenRecord,
}: {
  record: RecordDetail;
  onClose(): void;
  onCreated(result: CreateRecordsResult): void;
  onOpenRecord(id: string): void;
}) {
  const me = useMe();
  const baseId = useId();
  const ids = { level: `${baseId}-level`, numeric: `${baseId}-numeric` };
  const [intent, setIntent] = useState<RecordIntent | null>(null);
  const [levelId, setLevelId] = useState('');
  const [numeric, setNumeric] = useState('');
  const [sources, setSources] = useState<SourcesValue>({ dois: [''] });
  const [sourcesReady, setSourcesReady] = useState(true);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState<CreateRecordsResult | null>(null);

  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const levels =
    dictionary.data?.flatMap((c) => c.traits).find((t) => t.id === record.trait.id)?.levels ?? [];
  const valueType = record.trait.valueType;
  const summary = useQuery({
    queryKey: datasetKeys.speciesTraits(record.speciesId, false),
    queryFn: () => fetchSpeciesTraits(record.speciesId),
  });
  const categoricalContest = intent === 'contest' && valueType === 'categorical';
  // E \ S (RFC-63 R14): the summary lists the levels with visible records;
  // only the active ones count.
  const activeIds = new Set(levels.filter((level) => level.active).map((level) => level.id));
  const contestedLevelIds = (
    summary.data?.flatMap((c) => c.traits).find((t) => t.trait.id === record.trait.id)?.levels ?? []
  )
    .map((level) => level.levelId)
    .filter((id) => activeIds.has(id) && id !== levelId);
  const nothingContested =
    categoricalContest && summary.isSuccess && levelId !== '' && contestedLevelIds.length === 0;
  const contestBlocked = categoricalContest && (!summary.isSuccess || nothingContested);

  const save = useRecordWrite<CreateRecordBody, CreateRecordsResult>({
    write: createRecords,
    speciesId: record.speciesId,
    onInvalidated: (result) => {
      if (result.duplicates.length === 0 && result.validated.length === 0) onCreated(result);
      else setAnswered(result);
    },
  });

  const serverErrors = fieldErrors(save.error);
  const valueErrors: Record<string, string> = {};
  for (const path of VALUE_PATHS) {
    const message = local[path] ?? serverErrors[path];
    if (message !== undefined) valueErrors[path] = message;
  }
  const showApiAlert = save.isError && !boundToAField(serverErrors);
  // A refusal this form raised itself comes first: it is the answer to the
  // click that raised it, and no request was sent for the API to answer.
  const alertMessage =
    local.form ?? (showApiAlert ? apiAlertMessage(save.error, serverErrors) : undefined);
  const activeLevels = levels.filter((level) => level.active);

  function chooseIntent(next: RecordIntent) {
    setIntent(next);
    setLocal({});
    save.reset();
  }

  // The value control shows `value.<branch>` or, for an issue the union
  // reported at its own path, `value`; supplying a value answers both, so
  // both go — leaving either would keep "Choose a level." and its red ring
  // under a control that now holds one, until the next submit.
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
    if (!intent || contestBlocked) return;
    // Required fields first: `value` is a union, so a missing level or a
    // `NaN` fails both branches and Zod reports one issue at `value`, never
    // at the nested path the messages key on (as in `AddEntriesDialog`).
    const required: Record<string, string> = {};
    if (valueType === 'categorical' && levelId === '') {
      required['value.levelId'] = LOCAL_MESSAGES['value.levelId'] ?? '';
    }
    if (valueType === 'quantitative' && (numeric.trim() === '' || Number.isNaN(Number(numeric)))) {
      required['value.numeric'] = LOCAL_MESSAGES['value.numeric'] ?? '';
    }
    // The submit button stays live while a DOI is unresolved: a dead control
    // explains nothing, and this sentence is what ties the refusal to the row.
    if (!sourcesReady) required.form = SOURCES_NOT_READY;
    if (Object.keys(required).length > 0) {
      save.reset();
      setLocal(required);
      return;
    }

    const candidate = {
      speciesId: record.speciesId,
      traitId: record.trait.id,
      value:
        valueType === 'quantitative'
          ? { quantitative: { single: Number(numeric) } }
          : { levelIds: [levelId] },
      sources: sourcesToBody(sources),
      intent,
      ...(categoricalContest ? { contestedLevelIds } : { respondsToRecordId: record.id }),
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

  const title = `Add a different record for ${humaniseKey(record.trait.key)} of ${record.species.canonicalName}`;

  if (answered) {
    return (
      <Dialog open title={title} onClose={onClose}>
        <div className="flex flex-col gap-4">
          <Alert tone="info">
            {[
              answered.duplicates.length > 0 ? 'One of these claims already existed.' : null,
              answered.validated.length > 0
                ? 'Matches an existing record — counted as your validation.'
                : null,
            ]
              .filter((sentence) => sentence !== null)
              .join(' ')}
          </Alert>
          <ul className="flex flex-col gap-1">
            {[...answered.duplicates, ...answered.validated].map((ref) => (
              <li key={ref.recordId}>
                <button
                  type="button"
                  className="text-left text-cell font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                  onClick={() => onOpenRecord(ref.recordId)}
                >
                  {`Open record …${ref.recordId.slice(-6)}`}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button onClick={() => onCreated(answered)}>
              {answered.created.length > 0 ? 'Open the record you added' : 'Close'}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open title={title} onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-label font-bold uppercase tracking-[0.08em] text-canopy-800">
            What does your value mean?
          </legend>
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
        </fieldset>

        <fieldset disabled={!intent} className="flex flex-col gap-4">
          <legend className="text-label font-bold uppercase tracking-[0.08em] text-canopy-800">
            Your record
          </legend>
          <ValueField
            trait={{ valueType, unit: record.trait.unit, levels }}
            levelId={levelId}
            numeric={numeric}
            onLevel={chooseLevel}
            onNumeric={changeNumeric}
            errors={valueErrors}
            ids={ids}
          />
          {valueType === 'categorical' && activeLevels.length === 0 && !dictionary.isPending ? (
            // An empty select needs a reason: the dictionary did not load, or
            // it loaded without this trait (inactive, or out of the viewer's
            // visibility) and there is nothing this form can offer.
            <p className="text-meta text-red-700">
              {dictionary.isError
                ? 'Could not load the levels. Reload the page.'
                : 'This trait has no level to choose from.'}
            </p>
          ) : null}
          <SourcesField
            value={sources}
            onChange={setSources}
            errors={serverErrors}
            onValidity={setSourcesReady}
          />
          <p className="text-meta text-mist-500">{`Recorded as ${me.user.name}`}</p>
        </fieldset>

        {nothingContested ? <Alert tone="info">{NOTHING_CONTESTED}</Alert> : null}
        {alertMessage ? <Alert tone="error">{alertMessage}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} disabled={!intent || contestBlocked}>
            Add record
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
