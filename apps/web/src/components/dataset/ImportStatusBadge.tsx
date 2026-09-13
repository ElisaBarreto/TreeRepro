import type { ImportBatchStatus } from '@treerepro/contracts';
import { Badge } from '../ui/index.ts';

const TONES: Record<ImportBatchStatus, 'green' | 'red' | 'amber'> = {
  completed: 'green',
  failed: 'red',
  running: 'amber',
};

/**
 * The status of an import batch as the API computed it.
 * @rfc RFC-13 R5
 * @rfc RFC-64 R11
 */
export function ImportStatusBadge({ status }: { status: ImportBatchStatus }) {
  return <Badge tone={TONES[status]}>{status}</Badge>;
}
