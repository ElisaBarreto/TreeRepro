import { Link } from '@tanstack/react-router';
import type { ContestedQueueItem, MeResponse, RecordItem } from '@treerepro/contracts';
import { humaniseKey, isoDate } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { Badge, Button, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

/**
 * The three resolutions a reviewer can pick from an open contest (RFC-65
 * R15): **Keep both** and **Withdraw contest** act on the contest itself
 * (R16); **withdrawLevel** withdraws one of the contest's named levels (R14,
 * categorical only — hence the level it names) and **withdrawTarget**
 * withdraws the record a quantitative contest responds to (`target`,
 * through the annotations route).
 * @rfc RFC-65 R10, R14-R16
 */
export type ContestAction =
  | { kind: 'keep' }
  | { kind: 'withdrawContest' }
  | { kind: 'withdrawLevel'; levelId: string; key: string }
  | { kind: 'withdrawTarget'; target: RecordItem };

function mayWithdraw(
  me: Pick<MeResponse, 'user' | 'permissions'>,
  record: Pick<RecordItem, 'origin' | 'createdBy'>,
): boolean {
  return (
    hasPermission(me, 'records.annotate') &&
    (record.createdBy?.id === me.user.id ||
      hasPermission(
        me,
        record.origin === 'manual' ? 'records.withdraw' : 'records.withdraw_imported',
      ))
  );
}

/**
 * Open contests as rows: species (linked), trait, what the contest names as
 * the correct value (a categorical contest's levels, each marked when it is
 * still contested; a quantitative contest's target, a button opening its
 * record), the contest's own records (buttons opening each, "No record" for
 * a contest that created none), who raised it, when, and the resolutions
 * RFC-13 R3 says the viewer's permissions allow.
 * @rfc RFC-65 R10, R14-R16
 * @rfc RFC-13 R3
 */
export function DisputedTable({
  items,
  onSelect,
  onAction,
}: {
  items: ContestedQueueItem[];
  onSelect: (recordId: string) => void;
  onAction: (item: ContestedQueueItem, action: ContestAction) => void;
}) {
  const me = useMe();
  const canWithdrawContest = (item: ContestedQueueItem) =>
    hasPermission(me, 'records.annotate') &&
    (item.createdBy.id === me.user.id || hasPermission(me, 'records.withdraw'));

  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Species</Th>
          <Th>Trait</Th>
          <Th>Contested value</Th>
          <Th>Contest records</Th>
          <Th>By</Th>
          <Th>Date</Th>
          <Th>Actions</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((item) => (
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
              {item.levels ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.levels.map((level) => (
                    // Colour is not the only cue (WCAG 1.4.1): a level the
                    // contest names but no longer contests says so in words.
                    <Badge key={level.levelId} tone={level.contested ? 'amber' : 'neutral'}>
                      <span>{level.key}</span>
                      {level.contested ? null : <span> (cleared)</span>}
                    </Badge>
                  ))}
                </div>
              ) : item.target ? (
                <button
                  type="button"
                  onClick={() => onSelect((item.target as RecordItem).id)}
                  className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                >
                  {item.target.valueText}
                </button>
              ) : null}
            </Td>
            <Td>
              {item.records.length === 0 ? (
                <span className="text-mist-500">No record</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {item.records.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => onSelect(record.id)}
                      className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                    >
                      {record.valueText}
                    </button>
                  ))}
                </div>
              )}
            </Td>
            <Td>{item.createdBy.name}</Td>
            <Td className="whitespace-nowrap tabular-nums">
              <time dateTime={item.createdAt}>{isoDate(item.createdAt)}</time>
            </Td>
            <Td>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onAction(item, { kind: 'keep' })}
                >
                  Keep both
                </Button>
                {canWithdrawContest(item) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onAction(item, { kind: 'withdrawContest' })}
                  >
                    Withdraw contest
                  </Button>
                ) : null}
                {item.levels
                  ?.filter((level) => level.contested)
                  .map((level) => (
                    <Button
                      key={level.levelId}
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        onAction(item, {
                          kind: 'withdrawLevel',
                          levelId: level.levelId,
                          key: level.key,
                        })
                      }
                    >
                      Withdraw "{level.key}"
                    </Button>
                  ))}
                {item.target && mayWithdraw(me, item.target) ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      onAction(item, { kind: 'withdrawTarget', target: item.target as RecordItem })
                    }
                  >
                    Withdraw record
                  </Button>
                ) : null}
              </div>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
