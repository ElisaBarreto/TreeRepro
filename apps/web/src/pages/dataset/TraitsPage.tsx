import { useQuery } from '@tanstack/react-query';
import type { Trait } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { EditTraitDialog } from '../../components/catalog/EditTraitDialog.tsx';
import { LevelsEditor } from '../../components/catalog/LevelsEditor.tsx';
import { NewTraitDialog } from '../../components/catalog/NewTraitDialog.tsx';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

const DASH = <span className="text-mist-500">—</span>;

/**
 * Trait dictionary browser: the whole dictionary arrives at once (RFC-62 R5)
 * and a local filter narrows the trait keys; categories without a matching
 * trait disappear. Each trait row can unfold its levels; inactive traits and
 * levels stay visible, marked as such, because records may still cite them.
 * With `traits.manage`, a header action creates a trait and each row can
 * edit its own.
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-62 R5, R6
 */
export function TraitsPage() {
  const me = useMe();
  const canManage = hasPermission(me, 'traits.manage');
  const dictionary = useQuery({ queryKey: datasetKeys.dictionary, queryFn: fetchDictionary });
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  // Lifted above the table, not per row: `Dialog` renders a native `<dialog>`
  // without a portal, so it must never nest inside `<tbody>`/`<tr>` (see
  // `MapDialog` in `PendingPage.tsx` for the same pattern).
  const [editing, setEditing] = useState<{ trait: Trait; categoryKey: string } | null>(null);
  const filterId = useId();
  const term = humaniseKey(filter.trim().toLowerCase());
  const categories = (dictionary.data ?? [])
    .map((category) => ({
      ...category,
      traits: category.traits.filter((trait) =>
        humaniseKey(trait.key.toLowerCase()).includes(term),
      ),
    }))
    .filter((category) => category.traits.length > 0);
  const total = (dictionary.data ?? []).reduce((sum, c) => sum + c.traits.length, 0);
  const allCategories = (dictionary.data ?? []).map((c) => ({ key: c.key, label: c.label }));

  return (
    <>
      <PageHeader
        title="Traits"
        description="The controlled vocabulary every record is harmonised against."
        actions={
          canManage ? <Button onClick={() => setCreating(true)}>New trait</Button> : undefined
        }
      />
      <div className="flex flex-col gap-6">
        <div className="max-w-md">
          <Field id={filterId} label="Filter traits">
            <Input
              id={filterId}
              type="search"
              autoComplete="off"
              placeholder="Trait key, e.g. seed mass"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Field>
        </div>
        {dictionary.error ? <Alert tone="error">{pageErrorMessage(dictionary.error)}</Alert> : null}
        {dictionary.isPending ? <p className="text-body text-mist-500">Loading…</p> : null}
        {dictionary.isSuccess && total === 0 ? (
          <EmptyState title="The dictionary is empty." />
        ) : null}
        {dictionary.isSuccess && total > 0 && categories.length === 0 ? (
          <EmptyState title="No traits match." />
        ) : null}
        {categories.map((category) => (
          <CategorySection
            key={category.key}
            label={category.label}
            traits={category.traits}
            canManage={canManage}
            onEdit={(trait) => setEditing({ trait, categoryKey: category.key })}
          />
        ))}
      </div>
      {creating ? (
        <NewTraitDialog
          categories={allCategories}
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      ) : null}
      {editing ? (
        <EditTraitDialog
          trait={editing.trait}
          categoryKey={editing.categoryKey}
          categories={allCategories}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function CategorySection({
  label,
  traits,
  canManage,
  onEdit,
}: {
  label: string;
  traits: Trait[];
  canManage: boolean;
  onEdit: (trait: Trait) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-display text-section font-semibold text-canopy-950">
        {label}
      </h2>
      <Table>
        <Thead>
          <Tr>
            <Th>Trait</Th>
            <Th>Type</Th>
            <Th>Unit</Th>
            <Th>Description</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {traits.map((trait) => (
            <TraitRows key={trait.id} trait={trait} canManage={canManage} onEdit={onEdit} />
          ))}
        </Tbody>
      </Table>
    </section>
  );
}

/**
 * A trait's row and, once unfolded, the row below it listing its levels.
 * `onEdit` reports the click up to `TraitsPage`, which owns the edit dialog
 * — a native `<dialog>` cannot nest inside `<tbody>`/`<tr>` — rather than
 * opening one itself (`MapDialog` in `PendingPage.tsx` follows the same
 * pattern).
 */
function TraitRows({
  trait,
  canManage,
  onEdit,
}: {
  trait: Trait;
  canManage: boolean;
  onEdit: (trait: Trait) => void;
}) {
  const [open, setOpen] = useState(false);
  const levelsId = useId();
  const name = humaniseKey(trait.key);
  return (
    <>
      <Tr>
        <Td className="font-medium text-canopy-900">{name}</Td>
        <Td>{trait.valueType}</Td>
        <Td>{trait.unit ?? DASH}</Td>
        <Td className="text-canopy-800">{trait.description}</Td>
        <Td>{trait.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</Td>
        <Td className="whitespace-nowrap">
          <div className="flex items-center gap-2">
            {trait.valueType === 'categorical' && (trait.levels.length > 0 || canManage) ? (
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={open}
                aria-controls={open ? levelsId : undefined}
                onClick={() => setOpen((value) => !value)}
              >
                {open ? 'Hide levels' : 'Show levels'}
              </Button>
            ) : null}
            {canManage ? (
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Edit ${name}`}
                onClick={() => onEdit(trait)}
              >
                Edit
              </Button>
            ) : null}
          </div>
        </Td>
      </Tr>
      {open ? (
        <Tr id={levelsId} className="bg-mist-50">
          <Td colSpan={6}>
            <LevelsEditor trait={trait} canManage={canManage} />
          </Td>
        </Tr>
      ) : null}
    </>
  );
}
