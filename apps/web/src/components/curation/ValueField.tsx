import type { Trait } from '@treerepro/contracts';
import { Field, Input, Select } from '../ui/index.ts';

export interface ValueFieldProps {
  /** The trait the value belongs to; only its type, unit and levels matter. */
  trait: Pick<Trait, 'valueType' | 'unit' | 'levels'>;
  levelId: string;
  numeric: string;
  onLevel(id: string): void;
  onNumeric(text: string): void;
  /** Field errors keyed by the API's paths (`value`, `value.levelId`, `value.numeric`). */
  errors: Record<string, string>;
  ids: { level: string; numeric: string };
}

/**
 * The control one trait's value needs: the select over its active levels for
 * a categorical trait, the number in its unit for a quantitative one. The
 * form above owns the state, so the same control serves the add-entries and
 * the contest forms. A union issue the schema reports at `value` (a `NaN`
 * fails both branches of the union and never reaches the nested paths) shows
 * under the control as well.
 * @rfc RFC-65 R1
 */
export function ValueField({
  trait,
  levelId,
  numeric,
  onLevel,
  onNumeric,
  errors,
  ids,
}: ValueFieldProps) {
  if (trait.valueType === 'categorical') {
    const error = errors['value.levelId'] ?? errors.value;
    return (
      <Field id={ids.level} label="Level" error={error}>
        <Select
          id={ids.level}
          value={levelId}
          onChange={(e) => onLevel(e.target.value)}
          invalid={Boolean(error)}
        >
          <option value="">Choose a level</option>
          {trait.levels
            .filter((level) => level.active)
            .map((level) => (
              <option key={level.id} value={level.id}>
                {level.key}
              </option>
            ))}
        </Select>
      </Field>
    );
  }
  const error = errors['value.numeric'] ?? errors.value;
  return (
    <Field
      id={ids.numeric}
      label={trait.unit ? `Number (${trait.unit})` : 'Number'}
      error={error}
      trailing={
        trait.unit ? <span className="text-meta text-mist-500">{trait.unit}</span> : undefined
      }
    >
      <Input
        id={ids.numeric}
        type="number"
        step="any"
        inputMode="decimal"
        value={numeric}
        onChange={(e) => onNumeric(e.target.value)}
        invalid={Boolean(error)}
      />
    </Field>
  );
}
