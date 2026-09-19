import type { PlatformHealth } from '@treerepro/contracts';
import { formatNumber } from '../../lib/format.ts';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

/**
 * The 14-day activity series `GET /api/admin/health` answers, oldest day
 * first as the API orders it, one row per day.
 * @rfc RFC-52 R1
 */
export function ActivityTable({ byDay }: { byDay: PlatformHealth['activity']['byDay'] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Day</Th>
          <Th className="text-right">Records</Th>
          <Th className="text-right">Annotations</Th>
        </Tr>
      </Thead>
      <Tbody>
        {byDay.map((row) => (
          <Tr key={row.day}>
            <Td className="whitespace-nowrap tabular-nums">{row.day}</Td>
            <Td className="text-right tabular-nums">{formatNumber(row.records)}</Td>
            <Td className="text-right tabular-nums">{formatNumber(row.annotations)}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
