import { render, screen } from '@testing-library/react';
import type { JobRunSummary } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { JobRow, jobBadge } from './JobRow.tsx';

const NOW = new Date('2026-09-19T12:00:00.000Z');

function run(overrides: Partial<JobRunSummary>): JobRunSummary {
  return {
    startedAt: '2026-09-19T10:00:00.000Z',
    finishedAt: '2026-09-19T10:05:00.000Z',
    status: 'completed',
    detail: {},
    error: null,
    ...overrides,
  };
}

describe('RFC-52 R3 jobBadge', () => {
  it('is green when the newest run completed within 26 hours', () => {
    expect(
      jobBadge(run({ status: 'completed', startedAt: '2026-09-19T10:00:00.000Z' }), NOW),
    ).toEqual({
      tone: 'green',
      label: 'completed',
    });
  });

  it('is green when the newest run was skipped within 26 hours', () => {
    expect(
      jobBadge(run({ status: 'skipped', startedAt: '2026-09-19T10:00:00.000Z' }), NOW),
    ).toEqual({
      tone: 'green',
      label: 'skipped',
    });
  });

  it('is green at exactly 26 hours (the boundary is inclusive)', () => {
    expect(
      jobBadge(run({ status: 'completed', startedAt: '2026-09-18T10:00:00.000Z' }), NOW),
    ).toEqual({ tone: 'green', label: 'completed' });
  });

  it('is amber "stale" once a completed run passes 26 hours', () => {
    expect(
      jobBadge(run({ status: 'completed', startedAt: '2026-09-18T09:00:00.000Z' }), NOW),
    ).toEqual({ tone: 'amber', label: 'stale' });
  });

  it('is amber "stale" once a skipped run passes 26 hours', () => {
    expect(
      jobBadge(run({ status: 'skipped', startedAt: '2026-09-10T00:00:00.000Z' }), NOW),
    ).toEqual({ tone: 'amber', label: 'stale' });
  });

  it('ruling R-M: is green "running" when the newest run started within 26 hours', () => {
    expect(
      jobBadge(run({ status: 'running', startedAt: '2026-09-19T10:00:00.000Z' }), NOW),
    ).toEqual({ tone: 'green', label: 'running' });
  });

  it('ruling R-M: is amber "stale" once a still-running run passes 26 hours', () => {
    expect(
      jobBadge(run({ status: 'running', startedAt: '2026-09-10T00:00:00.000Z' }), NOW),
    ).toEqual({ tone: 'amber', label: 'stale' });
  });

  it('is red "failed" when the newest run failed, whatever its age', () => {
    expect(jobBadge(run({ status: 'failed', startedAt: '2026-09-01T00:00:00.000Z' }), NOW)).toEqual(
      { tone: 'red', label: 'failed' },
    );
  });

  it('is "never ran" when there is no run at all', () => {
    expect(jobBadge(null, NOW)).toEqual({ tone: 'neutral', label: 'never ran' });
  });
});

function renderRow(run: JobRunSummary | null) {
  render(
    <table>
      <tbody>
        <JobRow label="Digest" run={run} now={NOW} />
      </tbody>
    </table>,
  );
}

describe('RFC-52 R1, R3 JobRow', () => {
  it('shows the job label and its status badge', () => {
    renderRow(run({ status: 'completed', startedAt: '2026-09-19T10:00:00.000Z' }));
    expect(screen.getByText('Digest')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('shows the started and finished timestamps', () => {
    renderRow(
      run({
        startedAt: '2026-09-19T10:00:00.000Z',
        finishedAt: '2026-09-19T10:05:00.000Z',
      }),
    );
    expect(screen.getByText('2026-09-19 10:00')).toBeInTheDocument();
    expect(screen.getByText('2026-09-19 10:05')).toBeInTheDocument();
  });

  it('shows "never ran" with dashes when the job has no run', () => {
    renderRow(null);
    expect(screen.getByText('never ran')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('shows the run error on a failed job', () => {
    renderRow(run({ status: 'failed', error: 'connection refused' }));
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('connection refused')).toBeInTheDocument();
  });
});
