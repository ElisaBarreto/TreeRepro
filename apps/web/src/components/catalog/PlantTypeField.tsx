import {
  PLANT_TYPE_LABELS,
  PLANT_TYPES,
  type PlantType,
  type Platform,
} from '@treerepro/contracts';
import { useId } from 'react';
import { currentPlatform } from '../../lib/platform.ts';
import { Field, Input, Select } from '../ui/index.ts';

/**
 * The plant type of a species being registered (RFC-65 R18). On PlantRepro a
 * select the person must choose from; on TreeRepro, which registers only
 * trees, the fixed text `Tree` and nothing to send (the API makes it `tree`).
 * @rfc RFC-65 R18
 * @rfc RFC-75 R2, R4
 */
export function PlantTypeField({
  value,
  onChange,
  error,
  platform = currentPlatform(),
}: {
  value: PlantType | undefined;
  onChange: (next: PlantType | undefined) => void;
  error?: string;
  platform?: Platform;
}) {
  const id = useId();
  if (platform === 'treerepro') {
    return (
      <Field id={id} label="Plant type" hint="TreeRepro registers only trees." error={error}>
        <Input id={id} value={PLANT_TYPE_LABELS.tree} readOnly />
      </Field>
    );
  }
  return (
    <Field id={id} label="Plant type" error={error}>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange((event.target.value || undefined) as PlantType | undefined)}
        invalid={Boolean(error)}
      >
        <option value="">Choose a type</option>
        {PLANT_TYPES.map((type) => (
          <option key={type} value={type}>
            {PLANT_TYPE_LABELS[type]}
          </option>
        ))}
      </Select>
    </Field>
  );
}
