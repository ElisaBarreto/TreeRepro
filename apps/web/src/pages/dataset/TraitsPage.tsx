import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { TRAIT_VALUE_TYPES, type Trait, type TraitValueType } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { useHasMaps } from '../../api/maps.ts';
import { EditTraitDialog } from '../../components/catalog/EditTraitDialog.tsx';
import { LevelsEditor } from '../../components/catalog/LevelsEditor.tsx';
import { NewTraitDialog } from '../../components/catalog/NewTraitDialog.tsx';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  Input,
  PageHeader,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { formatNumber, humaniseKey, TRAIT_VALUE_TYPE_LABELS } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

const DASH = <span className="text-mist-500">—</span>;

/**
 * The dictionary filters, all of them search params of `/app/traits`, so a
 * narrowed list is a link the trait page and the dashboard can send.
 * @rfc RFC-62 R5
 */
export interface TraitsSearch {
  categoryKey?: string;
  traitId?: string;
  valueType?: TraitValueType;
}

/**
 * Trait dictionary browser. The filter row — category, trait, value type —
 * lives in the URL (RFC-62 R5 amendment): the category and the value type
 * narrow the dictionary server-side, the trait narrows the answer to the one
 * row, and a free-text box narrows the trait keys in the browser on top of
 * all three. The selects themselves are fed by the unfiltered dictionary, so
 * a chosen category can always be swapped for another one; with no filter in
 * force the two queries are one and the same cache entry, hence one request.
 * Each trait row links to its trait page, counts the species with data and
 * can unfold its levels as chips; an inactive trait is badged, an active one
 * needs no badge. Inactive traits and levels stay visible because records
 * may still cite them. With `traits.manage`, a header action creates a trait
 * and each row can edit its own. A row whose trait has maps carries a `map`
 * icon link to its maps page beside its name (RFC-76 R8).
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-62 R5, R6
 * @rfc RFC-76 R8
 */
export function TraitsPage({
  search,
  onSearchChange,
}: {
  search: TraitsSearch;
  onSearchChange: (next: TraitsSearch) => void;
}) {
  const me = useMe();
  const canManage = hasPermission(me, 'traits.manage');
  // The whole vocabulary, for the selects and for the category a `traitId`
  // deep link belongs to.
  const vocabulary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const params = { categoryKey: search.categoryKey, valueType: search.valueType };
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(params),
    queryFn: () => fetchDictionary(params),
  });
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  // Lifted above the table, not per row: `Dialog` renders a native `<dialog>`
  // without a portal, so it must never nest inside `<tbody>`/`<tr>` (see
  // `MapDialog` in `PendingPage.tsx` for the same pattern).
  const [editing, setEditing] = useState<{ trait: Trait; categoryKey: string } | null>(null);
  const ids = { filter: useId(), category: useId(), trait: useId(), valueType: useId() };
  const term = humaniseKey(filter.trim().toLowerCase());
  const categories = (dictionary.data ?? [])
    .map((category) => ({
      ...category,
      traits: category.traits.filter(
        (trait) =>
          humaniseKey(trait.key.toLowerCase()).includes(term) &&
          // The dictionary route has no trait filter of its own (RFC-62 R5),
          // so the one chosen trait is kept here.
          (search.traitId === undefined || trait.id === search.traitId),
      ),
    }))
    .filter((category) => category.traits.length > 0);
  const total = (dictionary.data ?? []).reduce((sum, c) => sum + c.traits.length, 0);
  const allCategories = (vocabulary.data ?? []).map((c) => ({ key: c.key, label: c.label }));
  // A `?traitId=` deep link may name no category; the trait's own is read out
  // of the vocabulary so the selects show the filter that is in force.
  const derivedCategory = search.traitId
    ? vocabulary.data?.find((category) =>
        category.traits.some((trait) => trait.id === search.traitId),
      )?.key
    : undefined;
  const effectiveCategory = search.categoryKey ?? derivedCategory;
  const categoryTraits =
    vocabulary.data?.find((category) => category.key === effectiveCategory)?.traits ?? [];
  const error = dictionary.error ?? vocabulary.error;
  const filtered = term !== '' || Boolean(search.categoryKey ?? search.valueType ?? search.traitId);

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
        <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <Field id={ids.filter} label="Filter traits">
            <Input
              id={ids.filter}
              type="search"
              autoComplete="off"
              placeholder="Trait key, e.g. seed mass"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Field>
          <Field id={ids.category} label="Category">
            <Select
              id={ids.category}
              value={effectiveCategory ?? ''}
              onChange={(event) =>
                onSearchChange({
                  ...search,
                  categoryKey: event.target.value || undefined,
                  // The trait belonged to the category being left behind.
                  traitId: undefined,
                })
              }
            >
              <option value="">All categories</option>
              {allCategories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.trait} label="Trait">
            <Select
              id={ids.trait}
              disabled={!effectiveCategory}
              value={search.traitId ?? ''}
              onChange={(event) =>
                // A category derived from the trait goes with it when the
                // trait is cleared; a chosen one is in the URL and survives.
                onSearchChange({ ...search, traitId: event.target.value || undefined })
              }
            >
              <option value="">All traits</option>
              {categoryTraits.map((trait) => (
                <option key={trait.id} value={trait.id}>
                  {humaniseKey(trait.key)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.valueType} label="Value type">
            <Select
              id={ids.valueType}
              value={search.valueType ?? ''}
              onChange={(event) =>
                onSearchChange({
                  ...search,
                  // Narrowed against the enum rather than cast: the select's
                  // own options are the only values it can carry.
                  valueType: TRAIT_VALUE_TYPES.find((type) => type === event.target.value),
                })
              }
            >
              <option value="">All types</option>
              {TRAIT_VALUE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TRAIT_VALUE_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error ? <Alert tone="error">{pageErrorMessage(error)}</Alert> : null}
        {dictionary.isPending ? <p className="text-body text-mist-500">Loading…</p> : null}
        {dictionary.isSuccess && categories.length === 0 ? (
          <EmptyState
            title={total === 0 && !filtered ? 'The dictionary is empty.' : 'No traits match.'}
          />
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
            <Th>Species</Th>
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
  const hasMaps = useHasMaps(trait.id);
  return (
    <>
      <Tr>
        <Td>
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to="/app/traits/$id"
              params={{ id: trait.id }}
              className="font-medium text-canopy-900 underline-offset-2 hover:underline"
            >
              {name}
            </Link>
            {trait.active ? null : <Badge>inactive</Badge>}
            {hasMaps ? (
              <Link
                to="/app/maps/$traitId"
                params={{ traitId: trait.id }}
                aria-label={`Maps of ${name}`}
                className="inline-flex size-7 items-center justify-center rounded-full text-mist-400 transition-colors hover:bg-mist-50 hover:text-canopy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
              >
                <Icon name="map" size={16} />
              </Link>
            ) : null}
          </span>
        </Td>
        <Td>{TRAIT_VALUE_TYPE_LABELS[trait.valueType]}</Td>
        <Td>{trait.unit ?? DASH}</Td>
        <Td className="text-canopy-800">{trait.description}</Td>
        <Td>{formatNumber(trait.speciesCount)}</Td>
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
