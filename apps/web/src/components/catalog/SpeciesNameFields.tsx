import { NAME_SOURCES, type NameSource } from '@treerepro/contracts';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { NAME_SOURCE_LABELS } from '../../lib/format.ts';
import { Field, Input, Select } from '../ui/index.ts';

/**
 * The canonical name and its source — the pair every species form carries,
 * whether it creates a species (RFC-60 R9) or approves a proposal into one
 * (RFC-75 R4). Everything below it differs between the two: the catalog form
 * addresses a genus and family by id, the approval sends their names.
 *
 * `hint` and `trailing` belong to the name field, which is where the
 * create form's **Look up** button and the line it writes go (RFC-81 R4);
 * `children` renders between the two fields, so an alert about that button
 * sits beside the button rather than at the far end of the form.
 * @rfc RFC-13 R5, R6
 * @rfc RFC-60 R9
 * @rfc RFC-75 R4
 */
export function SpeciesNameFields({
  canonicalName,
  onCanonicalNameChange,
  nameSource,
  onNameSourceChange,
  errors,
  hint,
  trailing,
  children,
}: {
  canonicalName: string;
  onCanonicalNameChange: (next: string) => void;
  nameSource: NameSource;
  onNameSourceChange: (next: NameSource) => void;
  /** Keyed by field name, as `fieldErrors` produces them. */
  errors: { canonicalName?: string; nameSource?: string };
  hint?: string;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const nameId = useId();
  const sourceId = useId();
  return (
    <>
      <Field
        id={nameId}
        label="Canonical name"
        error={errors.canonicalName}
        hint={hint}
        trailing={trailing}
      >
        <Input
          id={nameId}
          value={canonicalName}
          maxLength={200}
          onChange={(e) => onCanonicalNameChange(e.target.value)}
          invalid={Boolean(errors.canonicalName)}
        />
      </Field>
      {children}
      <Field id={sourceId} label="Name source" error={errors.nameSource}>
        <Select
          id={sourceId}
          value={nameSource}
          onChange={(e) => onNameSourceChange(e.target.value as NameSource)}
          invalid={Boolean(errors.nameSource)}
        >
          {NAME_SOURCES.map((source) => (
            <option key={source} value={source}>
              {NAME_SOURCE_LABELS[source]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
