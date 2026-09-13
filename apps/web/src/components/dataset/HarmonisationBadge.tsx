import type { HarmonisationStatus } from '@treerepro/contracts';
import { Badge } from '../ui/index.ts';

const LABELS: Record<HarmonisationStatus, { text: string; tone: 'neutral' | 'amber' }> = {
  harmonised: { text: 'harmonised', tone: 'neutral' },
  unknown_level: { text: 'unknown level', tone: 'amber' },
  multi_value: { text: 'multiple values', tone: 'amber' },
  not_numeric: { text: 'not a number', tone: 'amber' },
  empty: { text: 'empty', tone: 'neutral' },
};

/**
 * The harmonisation axis of a record as a chip: harmonised is quiet, the
 * three failure modes are amber (pending curation), empty is quiet.
 * @rfc RFC-63 R5
 */
export function HarmonisationBadge({ status }: { status: HarmonisationStatus }) {
  const { text, tone } = LABELS[status];
  return <Badge tone={tone}>{text}</Badge>;
}
