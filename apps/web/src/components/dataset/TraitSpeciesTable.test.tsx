import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TraitSpeciesItem, TraitSpeciesMode } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  TRAIT_SPECIES_MISSING,
  TRAIT_SPECIES_UNDECIDED,
  TRAIT_SPECIES_WITH_DATA,
} from '../../test/dataset-fixtures.ts';
import { TraitSpeciesTable } from './TraitSpeciesTable.tsx';

// The species name, the source and the first-entry button are all router
// `Link`s, so the table mounts inside a minimal router whose only page is the
// table itself.
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

/** Mounts the table and waits for the router to put it on the page. */
async function renderTable(items: TraitSpeciesItem[], mode: TraitSpeciesMode) {
  const utils = renderInRouter(<TraitSpeciesTable items={items} mode={mode} />);
  return { ...utils, rows: await screen.findAllByRole('row') };
}

const headers = (row: HTMLElement) =>
  within(row)
    .getAllByRole('columnheader')
    .map((th) => th.textContent);
const cells = (row: HTMLElement) => within(row).getAllByRole('cell');

describe('RFC-62 R8 TraitSpeciesTable in `with` mode', () => {
  it('names the species, its family and its records', async () => {
    const { rows } = await renderTable([TRAIT_SPECIES_WITH_DATA], 'with');
    expect(headers(rows[0] as HTMLElement)).toEqual(['Species', 'Family', 'Records']);
    const row = cells(rows[1] as HTMLElement);
    expect(
      within(row[0] as HTMLElement).getByRole('link', { name: 'Adenanthera pavonina' }),
    ).toHaveAttribute('href', `/app/species/${TRAIT_SPECIES_WITH_DATA.id}`);
    expect(row[1]).toHaveTextContent('Fabaceae');
    expect(row[2]).toHaveTextContent('4');
    // The levels this species has values on, in the order the API sent them.
    expect(row[2]).toHaveTextContent('dioecious 3 · hermaphrodite 1');
  });

  it('dashes the family when there is none', async () => {
    const { rows } = await renderTable([{ ...TRAIT_SPECIES_UNDECIDED, family: null }], 'with');
    const row = cells(rows[1] as HTMLElement);
    expect(row[1]).toHaveTextContent('—');
    expect(row).toHaveLength(3);
  });

  it('RFC-62 R8 shows the RFC-77 summary: the median and its basis, then mean, range, records and sources (issue #316)', async () => {
    const { rows } = await renderTable([TRAIT_SPECIES_UNDECIDED], 'with');
    const cell = cells(rows[1] as HTMLElement)[2] as HTMLElement;
    expect(within(cell).getByText('Median 1.75 mg (midpoint of the range)')).toBeInTheDocument();
    expect(within(cell).getByText('mean 1.75 · 0.5–3 · 1 record · 1 source')).toBeInTheDocument();
  });

  it('RFC-62 R8 the Species, Family and Records headers sort; Records only with data (issue #316)', async () => {
    const onSort = vi.fn();
    renderInRouter(
      <TraitSpeciesTable
        items={[TRAIT_SPECIES_WITH_DATA]}
        mode="with"
        sort={{ by: 'records', order: 'desc', onSort }}
      />,
    );
    const records = await screen.findByRole('columnheader', { name: /Records/ });
    expect(records).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /Species/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    await userEvent.click(screen.getByRole('button', { name: /Family/ }));
    expect(onSort).toHaveBeenCalledWith('family');
  });

  it('counts and summaries are nullable on their own: neither hides the other', async () => {
    const { rows } = await renderTable(
      [
        { ...TRAIT_SPECIES_WITH_DATA, summary: null },
        { ...TRAIT_SPECIES_WITH_DATA, id: TRAIT_SPECIES_MISSING.id, recordCount: null },
        {
          ...TRAIT_SPECIES_WITH_DATA,
          id: TRAIT_SPECIES_UNDECIDED.id,
          recordCount: null,
          summary: null,
        },
      ],
      'with',
    );
    // A count with nothing to summarise: the number alone.
    expect(cells(rows[1] as HTMLElement)[2]?.textContent).toBe('4');
    // A summary of records this page has no count for: the dash keeps the
    // count's place and the summary is printed all the same.
    expect(cells(rows[2] as HTMLElement)[2]?.textContent).toBe('—dioecious 3 · hermaphrodite 1');
    // Neither: the dash on its own.
    expect(cells(rows[3] as HTMLElement)[2]?.textContent).toBe('—');
  });

  it('flags an inactive species beside its name', async () => {
    const { rows } = await renderTable([{ ...TRAIT_SPECIES_WITH_DATA, active: false }], 'with');
    expect(
      within(cells(rows[1] as HTMLElement)[0] as HTMLElement).getByText('inactive'),
    ).toBeVisible();
  });
});

describe('RFC-62 R8 TraitSpeciesTable in `missing` mode', () => {
  it('drops the record columns and offers the species page opened on its missing traits', async () => {
    const { rows } = await renderTable([TRAIT_SPECIES_MISSING], 'missing');
    // The last column is the actions one: its header names itself for screen
    // readers and shows nothing.
    expect(headers(rows[0] as HTMLElement)).toEqual(['Species', 'Family', 'Actions']);
    expect(screen.queryByRole('columnheader', { name: 'Records' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Accepted value' })).not.toBeInTheDocument();
    const row = cells(rows[1] as HTMLElement);
    expect(row).toHaveLength(3);
    expect(row[1]).toHaveTextContent('Malvaceae');
    // RFC-70 R7: `?missing=true` is the species page's own checkbox, so that
    // page opens on the traits it has no record for — this one among them.
    expect(
      within(row[2] as HTMLElement).getByRole('link', { name: 'Add the first entry' }),
    ).toHaveAttribute('href', `/app/species/${TRAIT_SPECIES_MISSING.id}?missing=true`);
  });
});
