import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordItem } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_RECORD,
  PERSONAL_OBSERVATION_REFERENCE,
  PRIMARY_REFERENCE,
  RECORD,
  SECONDARY_REFERENCE,
} from '../../test/dataset-fixtures.ts';
import { RecordTable, recordValueLabel } from './RecordTable.tsx';

// The reference and species columns are router `Link`s, so the table mounts
// inside a minimal router whose only page is the table itself.
function renderInRouter(ui: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

const cells = (row: HTMLElement) => within(row).getAllByRole('cell');

// An imported categorical record with two references, validated twice and
// contested once.
const ROW: RecordItem = {
  ...RECORD,
  recordCode: 'EB_1',
  references: [PRIMARY_REFERENCE, PERSONAL_OBSERVATION_REFERENCE],
  secondaryReference: SECONDARY_REFERENCE,
  validationCount: 2,
  contestCount: 1,
  contested: true,
};
// A manual quantitative record with a summary instead of a single value.
const MEASURED: RecordItem = {
  ...PENDING_RECORD,
  recordCode: 'TR_7',
  level: null,
  quantitative: { min: 0.5, max: 3, mean: 1.2, sd: 0.4, n: 12 },
  references: [PRIMARY_REFERENCE],
  secondaryReference: null,
  validationCount: 0,
  contestCount: 0,
  contested: false,
};

describe('RFC-63 R8 RecordTable', () => {
  it('lists ID, value, references, secondary article, origin, harmonisation, counts and date; no review column', async () => {
    const onSelect = vi.fn();
    renderInRouter(<RecordTable records={[ROW, MEASURED]} onSelect={onSelect} />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toEqual([
      'ID',
      'Value',
      'References',
      'Secondary article',
      'Origin',
      'Harmonisation',
      'Counts',
      'Added',
    ]);
    const rows = screen.getAllByRole('row');
    const first = cells(rows[1] as HTMLElement);
    expect(first[0]).toHaveTextContent('EB_1');
    // R-4: every reference of the record, joined by "; ".
    expect(first[2]).toHaveTextContent('Renner2014; Personal observation (Ada)');
    expect(
      within(first[2] as HTMLElement).getByRole('link', { name: 'Renner2014' }),
    ).toHaveAttribute('href', `/app/references/${PRIMARY_REFERENCE.id}`);
    expect(within(first[3] as HTMLElement).getByRole('link', { name: 'TRY-6.0' })).toBeVisible();
    expect(first[4]).toHaveTextContent('import');
    expect(within(first[5] as HTMLElement).getByText('harmonised')).toBeInTheDocument();
    expect(first[6]).toHaveTextContent('✓ 2 / ✗ 1');
    expect(within(first[6] as HTMLElement).getByText('Contested')).toBeInTheDocument();
    expect(first[7]).toHaveTextContent('2026-09-01');
    expect(screen.queryByText('confirmed')).not.toBeInTheDocument();

    const second = cells(rows[2] as HTMLElement);
    expect(second[3]).toHaveTextContent(/^—$/);
    expect(second[6]).toHaveTextContent('✓ 0 / ✗ 0');
    expect(within(second[6] as HTMLElement).queryByText('Contested')).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: '0.5–3 · mean 1.2 · SD 0.4 mg (n = 12)' }),
    );
    expect(onSelect).toHaveBeenCalledWith(MEASURED);
  });

  it('reads a quantitative record by its single value, and a record with nothing harmonised by its text', () => {
    expect(recordValueLabel({ ...MEASURED, quantitative: { single: 1.5 } })).toBe('1.5 mg');
    expect(recordValueLabel({ ...MEASURED, quantitative: { max: 3 } })).toBe('…–3 mg');
    expect(recordValueLabel({ ...MEASURED, quantitative: null })).toBe('about two');
    expect(recordValueLabel(ROW)).toBe('dioecious');
  });

  it('says so with a dash when a record lists no reference', async () => {
    renderInRouter(<RecordTable records={[{ ...MEASURED, references: [] }]} onSelect={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    expect(cells(rows[1] as HTMLElement)[2]).toHaveTextContent(/^—$/);
  });

  it('cuts a long reference label at sixty characters and keeps it whole in the link title', async () => {
    const longKey = `Smith, J.; Doe, A. (2001). ${'x'.repeat(60)}`;
    const long: RecordItem = {
      ...ROW,
      references: [{ ...PRIMARY_REFERENCE, citationKey: longKey }],
    };
    renderInRouter(<RecordTable records={[long]} onSelect={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    const link = within(cells(rows[1] as HTMLElement)[2] as HTMLElement).getByRole('link');
    expect(link).toHaveTextContent(`${longKey.slice(0, 59)}…`);
    expect(link).toHaveAttribute('title', longKey);
  });

  it('with showSpecies and showTrait, leading columns name the species (as a link) and the trait', async () => {
    renderInRouter(
      <RecordTable records={[ROW, MEASURED]} onSelect={vi.fn()} showSpecies showTrait />,
    );
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.slice(0, 4)).toEqual(['Species', 'Trait', 'ID', 'Value']);
    const links = screen.getAllByRole('link', { name: 'Adenanthera pavonina' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `/app/species/${ROW.species.id}`);
    expect(links[0]).toHaveClass('italic');
    const rows = screen.getAllByRole('row');
    expect(cells(rows[1] as HTMLElement)[1]).toHaveTextContent('sexual system');
    expect(cells(rows[2] as HTMLElement)[1]).toHaveTextContent('seed mass');
  });

  it('spec §2 sorts on value, references, origin and added only, and says which is active', async () => {
    const onSort = vi.fn();
    renderInRouter(
      <RecordTable
        records={[ROW]}
        onSelect={vi.fn()}
        sort={{ by: 'added', order: 'desc', onSort }}
      />,
    );
    expect(await screen.findByRole('columnheader', { name: 'Added' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: 'Value' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    for (const name of ['ID', 'Secondary article', 'Harmonisation', 'Counts']) {
      expect(screen.getByRole('columnheader', { name })).not.toHaveAttribute('aria-sort');
    }
    await userEvent.click(screen.getByRole('button', { name: 'References' }));
    expect(onSort).toHaveBeenCalledWith('references');
  });
});

describe('RFC-71 R2 RecordTable extra column', () => {
  it("appends one column of the caller's own, cell by row", async () => {
    renderInRouter(
      <RecordTable
        records={[ROW, MEASURED]}
        onSelect={vi.fn()}
        extra={{ header: 'Status', cell: (record) => (record.contested ? 'contested' : 'quiet') }}
      />,
    );
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.at(-1)).toBe('Status');
    const rows = screen.getAllByRole('row');
    expect(cells(rows[1] as HTMLElement).at(-1)).toHaveTextContent('contested');
    expect(cells(rows[2] as HTMLElement).at(-1)).toHaveTextContent('quiet');
  });

  it('adds no column when the caller passes none', async () => {
    renderInRouter(<RecordTable records={[ROW]} onSelect={vi.fn()} />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.at(-1)).toBe('Added');
  });
});
