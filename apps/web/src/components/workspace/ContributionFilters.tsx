import { useQuery } from '@tanstack/react-query';
import {
  type ContributionKind,
  REVIEW_STATUSES,
  type RecordIntent,
  type ReviewStatus,
} from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, fetchDictionary, searchSpecies } from '../../api/dataset.ts';
import { humaniseKey } from '../../lib/format.ts';
import { Combobox, type ComboboxOption, Field, Input, Select } from '../ui/index.ts';

/**
 * The filters of RFC-71 R1, as the page holds them. Every one of them is a
 * predicate on the record: on the annotated record when the annotations tab
 * is open (R3), never on the annotation's own date or kind.
 */
export interface ContributionFiltersValue {
  traitId?: string;
  speciesId?: string;
  review?: ReviewStatus;
  intent?: RecordIntent | 'none';
  from?: string;
  to?: string;
}

const INTENTS: readonly { value: RecordIntent | 'none'; label: string }[] = [
  { value: 'contest', label: 'Contest' },
  { value: 'complement', label: 'Complement' },
  { value: 'none', label: 'No intent' },
];

/**
 * Trait, species, review, intent and the two day bounds, fully controlled:
 * the page owns the value and mirrors it into the URL. The trait select is
 * fed by the dictionary and grouped by category; the species box searches
 * `GET /api/species` as you type. A species the URL names and nothing on
 * screen has named yet shows as "Selected species" with its Clear button, so
 * a deep link's filter is visible and removable without a lookup of its own.
 *
 * The date labels name the record, on both tabs: the API applies every
 * filter to the record, so on the annotations tab they narrow the annotated
 * record and never the annotation (RFC-71 R3), which the note below the
 * fields says in as many words.
 * @rfc RFC-71 R1, R3
 * @rfc RFC-13 R5, R6
 */
export function ContributionFilters({
  kind,
  value,
  onChange,
}: {
  kind: ContributionKind;
  value: ContributionFiltersValue;
  onChange: (next: ContributionFiltersValue) => void;
}) {
  const ids = {
    trait: useId(),
    species: useId(),
    review: useId(),
    intent: useId(),
    from: useId(),
    to: useId(),
  };
  const dictionary = useQuery({ queryKey: datasetKeys.dictionary, queryFn: fetchDictionary });
  // What the box last chose, so the chip can name the species; a species the
  // URL carried in on its own has only its id to show for itself.
  const [chosen, setChosen] = useState<ComboboxOption | null>(null);
  const species: ComboboxOption | null = value.speciesId
    ? chosen?.id === value.speciesId
      ? chosen
      : { id: value.speciesId, label: 'Selected species' }
    : null;

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-4 rounded-[12px] border border-canopy-700/15 px-4 pb-4">
        <legend className="px-1.5 text-label font-bold uppercase tracking-[0.08em] text-canopy-800">
          Filters
        </legend>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field
            id={ids.trait}
            label="Trait"
            error={dictionary.isError ? 'Could not load the trait dictionary.' : undefined}
          >
            <Select
              id={ids.trait}
              value={value.traitId ?? ''}
              onChange={(event) => onChange({ ...value, traitId: event.target.value || undefined })}
            >
              <option value="">All traits</option>
              {dictionary.data?.map((category) => (
                <optgroup key={category.key} label={category.label}>
                  {category.traits.map((trait) => (
                    <option key={trait.id} value={trait.id}>
                      {humaniseKey(trait.key)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field id={ids.species} label="Species">
            <Combobox
              id={ids.species}
              value={species}
              onChange={(next) => {
                setChosen(next);
                onChange({ ...value, speciesId: next?.id });
              }}
              search={async (term) => {
                const page = await searchSpecies({ q: term, limit: 10 });
                return page.data.map((item) => ({
                  id: item.id,
                  label: item.canonicalName,
                  hint: item.family?.name,
                }));
              }}
              searchKey="contributions-species"
              minChars={2}
              listLabel="Species suggestions"
              placeholder="Type to search species"
              emptyMessage="No species matches."
            />
          </Field>
          <Field id={ids.review} label="Review">
            <Select
              id={ids.review}
              value={value.review ?? ''}
              onChange={(event) =>
                onChange({
                  ...value,
                  review: (event.target.value || undefined) as ReviewStatus | undefined,
                })
              }
            >
              <option value="">Any review</option>
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.intent} label="Intent">
            <Select
              id={ids.intent}
              value={value.intent ?? ''}
              onChange={(event) =>
                onChange({
                  ...value,
                  intent: (event.target.value || undefined) as RecordIntent | 'none' | undefined,
                })
              }
            >
              <option value="">Any intent</option>
              {INTENTS.map((intent) => (
                <option key={intent.value} value={intent.value}>
                  {intent.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.from} label="Record added from">
            <Input
              id={ids.from}
              type="date"
              value={value.from ?? ''}
              onChange={(event) => onChange({ ...value, from: event.target.value || undefined })}
            />
          </Field>
          <Field id={ids.to} label="Record added to">
            <Input
              id={ids.to}
              type="date"
              value={value.to ?? ''}
              onChange={(event) => onChange({ ...value, to: event.target.value || undefined })}
            />
          </Field>
        </div>
      </fieldset>
      {kind === 'annotations' ? (
        <p className="text-meta text-mist-500">
          These filters apply to the annotated record, not to the annotation itself.
        </p>
      ) : null}
    </div>
  );
}
