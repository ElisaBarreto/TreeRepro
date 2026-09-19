import type { JobRunSummary } from '@treerepro/contracts';
import { formatDateTime } from '../../lib/format.ts';
import { Badge, Td, Tr } from '../ui/index.ts';

const DASH = <span className="text-mist-500">—</span>;
const HOUR_MS = 3_600_000;

/** How long a completed/skipped run stays green before it reads amber "stale" (RFC-52 R3). */
const STALE_HOURS = 26;

export type JobBadgeTone = 'green' | 'amber' | 'red' | 'neutral';

export interface JobBadgeInfo {
  tone: JobBadgeTone;
  label: string;
}

/**
 * One badge rule for both `jobs.auditPurge` and `jobs.digest`, so the two
 * rows never diverge in meaning: green when the newest run is `completed`
 * or `skipped` and started within the last 26 hours; amber `stale` past
 * that; red `failed` whatever the run's age when the status is `failed`;
 * `never ran` when there is no run at all. This supersedes spec §7's web
 * paragraph, which asked for amber on a failed digest and red on a failed
 * purge — an asymmetry with no rule number behind it (ruling R-B).
 * @rfc RFC-52 R3
 */
export function jobBadge(run: JobRunSummary | null, now: Date = new Date()): JobBadgeInfo {
  if (run === null) return { tone: 'neutral', label: 'never ran' };
  if (run.status === 'failed') return { tone: 'red', label: 'failed' };
  const ageHours = (now.getTime() - new Date(run.startedAt).getTime()) / HOUR_MS;
  if ((run.status === 'completed' || run.status === 'skipped') && ageHours <= STALE_HOURS) {
    return { tone: 'green', label: run.status };
  }
  return { tone: 'amber', label: 'stale' };
}

/**
 * One row of the platform health jobs table: the job's name, its badge
 * (RFC-52 R3) and the newest run's timing and error, if any. `now` is
 * injectable for tests; it defaults to the real clock.
 * @rfc RFC-52 R1, R3
 */
export function JobRow({
  label,
  run,
  now,
}: {
  label: string;
  run: JobRunSummary | null;
  now?: Date;
}) {
  const badge = jobBadge(run, now);
  return (
    <Tr>
      <Td className="font-medium">{label}</Td>
      <Td>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </Td>
      <Td className="whitespace-nowrap tabular-nums">
        {run ? formatDateTime(run.startedAt) : DASH}
      </Td>
      <Td className="whitespace-nowrap tabular-nums">
        {run?.finishedAt ? formatDateTime(run.finishedAt) : DASH}
      </Td>
      <Td>{run?.error ?? DASH}</Td>
    </Tr>
  );
}
