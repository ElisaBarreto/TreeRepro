import type { UserStatus } from '@treerepro/contracts';
import { Badge } from '../ui/index.ts';

const TONES = { invited: 'amber', active: 'green', suspended: 'red' } as const;

/** @rfc RFC-20 R2 */
export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <Badge tone={TONES[status]}>{status}</Badge>;
}
