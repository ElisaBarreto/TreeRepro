import { Link } from '@tanstack/react-router';
import type { RecordItem } from '@treerepro/contracts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { referenceLabel } from '../../lib/references.ts';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const DASH = <span className="text-mist-500">—</span>;

function valueLabel(record: RecordItem): string {
  if (record.level) return record.level.key;
  if (record.numericValue !== null) {
    const unit = record.trait.unit ? ` ${record.trait.unit}` : '';
    return `${formatNumber(record.numericValue)}${unit}`;
  }
  return record.valueText || '(empty)';
}

function SourceCell({ record }: { record: RecordItem }) {
  const reference = record.primaryReference ?? record.secondaryReference;
  if (!reference) return <Td>{DASH}</Td>;
  return (
    <Td>
      <Link
        to="/app/references/$id"
        params={{ id: reference.id }}
        className="font-medium text-canopy-900 underline-offset-2 hover:underline"
      >
        {referenceLabel(reference)}
      </Link>
    </Td>
  );
}

/**
 * The records waiting on the viewer's own review (spec §4): species, trait,
 * value and source, a row at a time; the value is a button that opens the
 * record drawer, same as every other record table in the app.
 * @rfc RFC-72 R3
 */
export function AwaitingTable({
  records,
  onSelect,
}: {
  records: RecordItem[];
  onSelect: (record: RecordItem) => void;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Species</Th>
          <Th>Trait</Th>
          <Th>Value</Th>
          <Th>Source</Th>
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
            <SourceCell record={record} />
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
