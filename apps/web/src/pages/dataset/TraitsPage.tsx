import { useQuery } from '@tanstack/react-query';
import type { Trait } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
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

const DASH = <span className="text-mist-500">—</span>;

/**
 * Trait dictionary browser: the whole dictionary arrives at once (RFC-62 R5)
 * and a local filter narrows the trait keys; categories without a matching
 * trait disappear. Each trait row can unfold its levels; inactive traits and
 * levels stay visible, marked as such, because records may still cite them.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-62 R5
 */
export function TraitsPage() {
  const dictionary = useQuery({ queryKey: datasetKeys.dictionary, queryFn: fetchDictionary });
  const [filter, setFilter] = useState('');
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

  return (
    <>
      <PageHeader
        title="Traits"
        description="The controlled vocabulary every record is harmonised against."
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
        {dictionary.isPending ? <p className="text-sm text-mist-500">Loading…</p> : null}
        {dictionary.isSuccess && total === 0 ? (
          <EmptyState title="The dictionary is empty." />
        ) : null}
        {dictionary.isSuccess && total > 0 && categories.length === 0 ? (
          <EmptyState title="No traits match." />
        ) : null}
        {categories.map((category) => (
          <CategorySection key={category.key} label={category.label} traits={category.traits} />
        ))}
      </div>
    </>
  );
}

function CategorySection({ label, traits }: { label: string; traits: Trait[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-display text-lg font-semibold text-canopy-950">
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
              <span className="sr-only">Levels</span>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {traits.map((trait) => (
            <TraitRows key={trait.id} trait={trait} />
          ))}
        </Tbody>
      </Table>
    </section>
  );
}

/** A trait's row and, once unfolded, the row below it listing its levels. */
function TraitRows({ trait }: { trait: Trait }) {
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
          {trait.levels.length > 0 ? (
            <Button
              variant="secondary"
              aria-expanded={open}
              aria-controls={open ? levelsId : undefined}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? 'Hide levels' : 'Show levels'}
            </Button>
          ) : null}
        </Td>
      </Tr>
      {open ? (
        <Tr id={levelsId} className="bg-mist-50">
          <Td colSpan={6}>
            <ul aria-label={`Levels of ${name}`} className="flex flex-wrap gap-1.5">
              {trait.levels.map((level) => (
                <li key={level.id}>
                  {level.active ? (
                    <Badge>{level.key}</Badge>
                  ) : (
                    <Badge>
                      <span className="line-through">{level.key}</span>
                      <span className="sr-only"> (inactive)</span>
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </Td>
        </Tr>
      ) : null}
    </>
  );
}
