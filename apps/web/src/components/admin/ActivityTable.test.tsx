import { render, screen, within } from '@testing-library/react';
import type { PlatformHealth } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { ActivityTable } from './ActivityTable.tsx';

function days(count: number): PlatformHealth['activity']['byDay'] {
  return Array.from({ length: count }, (_, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, '0')}`,
    records: i,
    annotations: i * 2,
  }));
}

describe('RFC-52 R1 ActivityTable', () => {
  it('renders exactly 14 data rows for the 14-day series', () => {
    render(<ActivityTable byDay={days(14)} />);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(15); // header + 14 days
  });

  it('renders each day with its record and annotation counts', () => {
    const rows = days(14);
    render(<ActivityTable byDay={rows} />);
    const table = screen.getByRole('table');
    const firstDataRow = within(table).getAllByRole('row')[1] as HTMLElement;
    const cells = within(firstDataRow).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent(rows[0]?.day as string);
    expect(cells[1]).toHaveTextContent('0');
    expect(cells[2]).toHaveTextContent('0');
    const lastDataRow = within(table).getAllByRole('row')[14] as HTMLElement;
    const lastCells = within(lastDataRow).getAllByRole('cell');
    expect(lastCells[1]).toHaveTextContent('13');
    expect(lastCells[2]).toHaveTextContent('26');
  });
});
