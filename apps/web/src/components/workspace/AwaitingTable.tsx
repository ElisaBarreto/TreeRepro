import { Link } from '@tanstack/react-router';
import type { RecordItem } from '@treerepro/contracts';
import { humaniseKey } from '../../lib/format.ts';
import { referenceLabel } from '../../lib/references.ts';
import { useSort } from '../../lib/use-sort.ts';
import { recordValueLabel } from '../dataset/RecordTable.tsx';
import { SortTh, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const DASH = <span className="text-mist-500">—</span>;

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
  const sorted = useSort(records, {
    species: (record) => record.species.canonicalName,
    trait: (record) => humaniseKey(record.trait.key),
    value: (record) => recordValueLabel(record),
  });
  return (
    <Table>
      <Thead>
        <Tr>
          <SortTh label="Species" {...sorted.header('species')} />
          <SortTh label="Trait" {...sorted.header('trait')} />
          <SortTh label="Value" {...sorted.header('value')} />
          <Th>Source</Th>
        </Tr>
      </Thead>
      <Tbody>
        {sorted.rows.map((record) => (
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
                {recordValueLabel(record)}
              </button>
            </Td>
            <SourceCell record={record} />
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
