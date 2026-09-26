import { Link } from '@tanstack/react-router';
import type { ContestedQueueItem } from '@treerepro/contracts';
import { humaniseKey, isoDate } from '../../lib/format.ts';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

/** What the contest contests: its levels, or the target's value (RFC-65 R10). */
function contestedLabel(item: ContestedQueueItem): string {
  if (item.levels) return item.levels.map((l) => l.key).join(', ');
  return item.target?.valueText ?? '';
}

/**
 * Standing contests as rows: species (linked), trait, what is contested (a
 * button that opens a record of the contest, when it has one), who contested
 * and when. Minimal until plan 13g Task 9 rebuilds the page.
 * @rfc RFC-65 R10
 */
export function DisputedTable({
  items,
  onSelect,
}: {
  items: ContestedQueueItem[];
  onSelect: (recordId: string) => void;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Species</Th>
          <Th>Trait</Th>
          <Th>Contested</Th>
          <Th>Contested by</Th>
          <Th>Date</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((item) => {
          const recordId = item.target?.id ?? item.records[0]?.id;
          return (
            <Tr key={item.id} className="transition-colors hover:bg-mist-50">
              <Td>
                <Link
                  to="/app/species/$id"
                  params={{ id: item.species.id }}
                  className="font-medium italic text-canopy-900 underline-offset-2 hover:underline"
                >
                  {item.species.canonicalName}
                </Link>
              </Td>
              <Td>{humaniseKey(item.trait.key)}</Td>
              <Td>
                {recordId ? (
                  <button
                    type="button"
                    onClick={() => onSelect(recordId)}
                    className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                  >
                    {contestedLabel(item)}
                  </button>
                ) : (
                  contestedLabel(item)
                )}
              </Td>
              <Td>{item.createdBy.name}</Td>
              <Td className="whitespace-nowrap tabular-nums">
                <time dateTime={item.createdAt}>{isoDate(item.createdAt)}</time>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
