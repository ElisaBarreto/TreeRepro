import { Link } from '@tanstack/react-router';
import type { DisputedRecord } from '@treerepro/contracts';
import { formatNumber, humaniseKey, isoDate } from '../../lib/format.ts';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

function valueLabel(record: DisputedRecord): string {
  if (record.level) return record.level.key;
  if (record.numericValue !== null)
    return `${formatNumber(record.numericValue)}${record.trait.unit ? ` ${record.trait.unit}` : ''}`;
  return record.valueText || '(empty)';
}

/**
 * Standing disputes as rows: species (linked), trait, value (a button that
 * opens the record), who disputed, their note and when.
 * @rfc RFC-65 R10
 */
export function DisputedTable({
  records,
  onSelect,
}: {
  records: DisputedRecord[];
  onSelect: (record: DisputedRecord) => void;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Species</Th>
          <Th>Trait</Th>
          <Th>Value</Th>
          <Th>Disputed by</Th>
          <Th>Note</Th>
          <Th>Date</Th>
        </Tr>
      </Thead>
      <Tbody>
        {records.map((record) => (
          <Tr key={record.id} className="transition-colors hover:bg-mist-50">
            <Td>
              <Link
                to="/app/species/$id"
                params={{ id: record.species.id }}
                className="font-medium italic text-canopy-900 underline-offset-2 hover:underline"
              >
                {record.species.canonicalName}
              </Link>
            </Td>
            <Td>{humaniseKey(record.trait.key)}</Td>
            <Td>
              <button
                type="button"
                onClick={() => onSelect(record)}
                className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
              >
                {valueLabel(record)}
              </button>
            </Td>
            <Td>{record.latestDispute.actor.name}</Td>
            <Td className="max-w-md">{record.latestDispute.note ?? ''}</Td>
            <Td className="whitespace-nowrap tabular-nums">
              <time dateTime={record.latestDispute.createdAt}>
                {isoDate(record.latestDispute.createdAt)}
              </time>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
