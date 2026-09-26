import type { QuantitativeValue, Trait } from '@treerepro/contracts';
import { Field, Input } from '../ui/index.ts';

/** The six inputs of a quantitative value, in the order the form shows them (R-5). @rfc RFC-65 R1 */
export const QUANTITATIVE_FIELDS = [
  { key: 'single', label: 'Single value' },
  { key: 'min', label: 'Min' },
  { key: 'max', label: 'Max' },
  { key: 'mean', label: 'Mean' },
  { key: 'sd', label: 'SD' },
  { key: 'n', label: 'n' },
] as const;

/** @rfc RFC-65 R1 */
export type QuantitativeKey = (typeof QUANTITATIVE_FIELDS)[number]['key'];
/** The six inputs as typed; `''` is a blank input. @rfc RFC-65 R1 */
export type QuantitativeText = Record<QuantitativeKey, string>;
/** @rfc RFC-65 R1 */
export const EMPTY_QUANTITATIVE: QuantitativeText = {
  single: '',
  min: '',
  max: '',
  mean: '',
  sd: '',
  n: '',
};

const QUANTITATIVE_HINT =
  'Give a single value, or summary statistics — at least one of single, min, max or mean. Min must not exceed max; SD is 0 or more; n is a whole number, 1 or more.';

/**
 * The filled inputs as numbers, the blank ones left out. The rules of R-5 are
 * the API's to enforce; the form only hints at them.
 * @rfc RFC-65 R1
 */
export function quantitativeToBody(text: QuantitativeText): QuantitativeValue {
  const value: QuantitativeValue = {};
  for (const { key } of QUANTITATIVE_FIELDS) {
    if (text[key].trim() !== '') value[key] = Number(text[key]);
  }
  return value;
}

/** @rfc RFC-65 R1 */
export interface ValueFieldProps {
  /** The trait the value belongs to; only its type, unit and levels matter. */
  trait: Pick<Trait, 'valueType' | 'unit' | 'levels'>;
  levelIds: string[];
  quantitative: QuantitativeText;
  onLevels(ids: string[]): void;
  onQuantitative(next: QuantitativeText): void;
  /** Field errors keyed by the API's paths (`value`, `value.levelIds[.<i>]`, `value.quantitative[.<key>]`). */
  errors: Record<string, string>;
  /** Prefix of the controls' ids; each control appends its own suffix. */
  idPrefix: string;
}

const LEGEND = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';

/**
 * The value one trait takes. A categorical trait gets a checkbox per active
 * level, several at once, each chosen level becoming a record of its own
 * (R-3). A quantitative trait gets six numeric inputs — single, min, max,
 * mean and SD in the trait's unit, and n — with the rules of R-5 as a hint
 * and the HTML bounds (`min`, `step`) as the only client-side guard; the API
 * validates. The form above owns the state, so the one control serves every
 * entry form. An issue the schema reports at `value` itself, or per-level at
 * `value.levelIds.<i>`, shows under the group.
 * @rfc RFC-65 R1
 */
export function ValueField({
  trait,
  levelIds,
  quantitative,
  onLevels,
  onQuantitative,
  errors,
  idPrefix,
}: ValueFieldProps) {
  if (trait.valueType === 'categorical') {
    const error =
      errors['value.levelIds'] ??
      Object.entries(errors).find(([key]) => key.startsWith('value.levelIds.'))?.[1] ??
      errors.value;
    const errorId = `${idPrefix}-error`;
    return (
      <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
        <legend className={LEGEND}>Levels</legend>
        {trait.levels
          .filter((level) => level.active)
          .map((level) => (
            <label key={level.id} className="flex items-center gap-2 text-body text-canopy-950">
              <input
                type="checkbox"
                className="size-4 accent-canopy-700"
                checked={levelIds.includes(level.id)}
                onChange={(event) =>
                  onLevels(
                    event.target.checked
                      ? [...levelIds, level.id]
                      : levelIds.filter((id) => id !== level.id),
                  )
                }
              />
              {level.key}
            </label>
          ))}
        {error ? (
          <p id={errorId} className="text-meta text-red-700">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }
  const unit = trait.unit ? ` (${trait.unit})` : '';
  const hintId = `${idPrefix}-hint`;
  const errorId = `${idPrefix}-error`;
  const groupError = errors['value.quantitative'] ?? errors.value;
  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-describedby={groupError ? `${hintId} ${errorId}` : hintId}
    >
      <legend className={LEGEND}>{`Value${unit}`}</legend>
      <p id={hintId} className="text-meta text-mist-500">
        {QUANTITATIVE_HINT}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {QUANTITATIVE_FIELDS.map(({ key, label }) => {
          const id = `${idPrefix}-${key}`;
          const error = errors[`value.quantitative.${key}`];
          const count = key === 'n';
          let lowest: number | undefined;
          if (count) lowest = 1;
          else if (key === 'sd') lowest = 0;
          return (
            <Field key={key} id={id} label={count ? label : `${label}${unit}`} error={error}>
              <Input
                id={id}
                type="number"
                inputMode={count ? 'numeric' : 'decimal'}
                step={count ? 1 : 'any'}
                min={lowest}
                value={quantitative[key]}
                onChange={(event) => onQuantitative({ ...quantitative, [key]: event.target.value })}
                invalid={Boolean(error)}
              />
            </Field>
          );
        })}
      </div>
      {groupError ? (
        <p id={errorId} className="text-meta text-red-700">
          {groupError}
        </p>
      ) : null}
    </fieldset>
  );
}
