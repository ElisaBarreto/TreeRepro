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
import { RecordTable } from './RecordTable.tsx';

// The article and species columns are router `Link`s, so the table mounts
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

describe('RFC-63 R8 RecordTable', () => {
  it('lists value, both articles, origin, both chips and the date; the value selects the row', async () => {
    const onSelect = vi.fn();
    renderInRouter(<RecordTable records={[RECORD, PENDING_RECORD]} onSelect={onSelect} />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toEqual([
      'Value',
      'Primary article',
      'Secondary article',
      'Origin',
      'Harmonisation',
      'Review',
      'Added',
    ]);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    const first = cells(rows[1] as HTMLElement);
    const primary = within(first[1] as HTMLElement).getByRole('link', { name: 'Renner2014' });
    expect(primary).toHaveAttribute('href', `/app/references/${PRIMARY_REFERENCE.id}`);
    expect(primary).not.toHaveAttribute('title');
    const secondary = within(first[2] as HTMLElement).getByRole('link', { name: 'TRY-6.0' });
    expect(secondary).toHaveAttribute('href', `/app/references/${SECONDARY_REFERENCE.id}`);
    expect(rows[1]).toHaveTextContent('import');
    expect(within(rows[1] as HTMLElement).getByText('harmonised')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('confirmed')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('2026-09-01');

    // PENDING_RECORD has no secondary article.
    const second = cells(rows[2] as HTMLElement);
    expect(
      within(second[1] as HTMLElement).getByRole('link', { name: 'Renner2014' }),
    ).toBeVisible();
    expect(second[2]).toHaveTextContent(/^—$/);
    expect(within(second[2] as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('manual');
    expect(within(rows[2] as HTMLElement).getByText('not a number')).toBeInTheDocument();
    expect(screen.queryByText('sexual system')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'about two' }));
    expect(onSelect).toHaveBeenCalledWith(PENDING_RECORD);
  });

  it('shows the same article in both columns when a record names it in both roles, and a dash for a missing primary', async () => {
    const same: RecordItem = { ...RECORD, secondaryReference: RECORD.primaryReference };
    const secondaryOnly: RecordItem = {
      ...PENDING_RECORD,
      primaryReference: null,
      secondaryReference: SECONDARY_REFERENCE,
    };
    renderInRouter(<RecordTable records={[same, secondaryOnly]} onSelect={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    const both = cells(rows[1] as HTMLElement);
    for (const cell of [both[1], both[2]]) {
      expect(within(cell as HTMLElement).getByRole('link', { name: 'Renner2014' })).toHaveAttribute(
        'href',
        `/app/references/${PRIMARY_REFERENCE.id}`,
      );
    }
    const only = cells(rows[2] as HTMLElement);
    expect(only[1]).toHaveTextContent(/^—$/);
    expect(within(only[2] as HTMLElement).getByRole('link', { name: 'TRY-6.0' })).toBeVisible();
  });

  it('cuts a long citation key at sixty characters and keeps it whole in the link title', async () => {
    const longKey = `Smith, J.; Doe, A. (2001). ${'x'.repeat(60)}`;
    const long: RecordItem = {
      ...RECORD,
      primaryReference: {
        id: PRIMARY_REFERENCE.id,
        citationKey: longKey,
        kind: 'publication',
        shortCitation: null,
      },
    };
    renderInRouter(<RecordTable records={[long]} onSelect={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    const link = within(cells(rows[1] as HTMLElement)[1] as HTMLElement).getByRole('link');
    expect(link).toHaveTextContent(`${longKey.slice(0, 59)}…`);
    expect(link).toHaveAttribute('title', longKey);
  });

  it('with showSpecies and showTrait, leading columns name the species (as a link) and the trait', async () => {
    const onSelect = vi.fn();
    renderInRouter(
      <RecordTable records={[RECORD, PENDING_RECORD]} onSelect={onSelect} showSpecies showTrait />,
    );
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toEqual([
      'Species',
      'Trait',
      'Value',
      'Primary article',
      'Secondary article',
      'Origin',
      'Harmonisation',
      'Review',
      'Added',
    ]);
    const links = screen.getAllByRole('link', { name: 'Adenanthera pavonina' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `/app/species/${RECORD.species.id}`);
    expect(links[0]).toHaveClass('italic');
    const rows = screen.getAllByRole('row');
    const firstCells = cells(rows[1] as HTMLElement);
    expect(firstCells[0]).toContainElement(links[0] as HTMLElement);
    expect(firstCells[1]).toHaveTextContent('sexual system');
    expect(cells(rows[2] as HTMLElement)[1]).toHaveTextContent('seed mass');

    await userEvent.click(screen.getByRole('button', { name: 'dioecious' }));
    expect(onSelect).toHaveBeenCalledWith(RECORD);
  });

  it('shows the trait column alone when only showTrait is set', async () => {
    renderInRouter(<RecordTable records={[RECORD]} onSelect={vi.fn()} showTrait />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.slice(0, 2)).toEqual(['Trait', 'Value']);
    expect(screen.queryByRole('link', { name: 'Adenanthera pavonina' })).not.toBeInTheDocument();
  });

  it('marks the accepted record row', async () => {
    renderInRouter(
      <RecordTable
        records={[RECORD, PENDING_RECORD]}
        onSelect={() => undefined}
        acceptedRecordId={RECORD.id}
      />,
    );
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(within(rows[0] as HTMLElement).getByText('accepted')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).queryByText('accepted')).not.toBeInTheDocument();
  });
});

describe('RFC-71 R2 RecordTable extra column', () => {
  it("appends one column of the caller's own, cell by row", async () => {
    renderInRouter(
      <RecordTable
        records={[RECORD, PENDING_RECORD]}
        onSelect={vi.fn()}
        extra={{
          header: 'Status',
          cell: (record) => (record.review === 'disputed' ? 'contested' : 'quiet'),
        }}
      />,
    );
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.at(-1)).toBe('Status');
    const rows = screen.getAllByRole('row');
    expect(cells(rows[1] as HTMLElement).at(-1)).toHaveTextContent('quiet');
    expect(cells(rows[2] as HTMLElement).at(-1)).toHaveTextContent('contested');
  });

  it('adds no column when the caller passes none', async () => {
    renderInRouter(<RecordTable records={[RECORD]} onSelect={vi.fn()} />);
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers.at(-1)).toBe('Added');
  });
});

describe('RFC-61 R4 RecordTable references', () => {
  it('names a personal observation instead of showing its key', async () => {
    renderInRouter(
      <RecordTable
        records={[{ ...RECORD, primaryReference: PERSONAL_OBSERVATION_REFERENCE }]}
        onSelect={vi.fn()}
      />,
    );
    expect(await screen.findByRole('link', { name: 'Personal observation' })).toBeInTheDocument();
    expect(screen.queryByText(PERSONAL_OBSERVATION_REFERENCE.citationKey)).not.toBeInTheDocument();
  });
});
