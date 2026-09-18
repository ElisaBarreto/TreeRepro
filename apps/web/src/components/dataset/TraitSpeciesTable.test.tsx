import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import type { TraitSpeciesItem, TraitSpeciesMode } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
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
async function renderTable(
  items: TraitSpeciesItem[],
  mode: TraitSpeciesMode,
  unit: string | null = null,
) {
  const utils = renderInRouter(<TraitSpeciesTable items={items} mode={mode} unit={unit} />);
  return { ...utils, rows: await screen.findAllByRole('row') };
}

const headers = (row: HTMLElement) =>
  within(row)
    .getAllByRole('columnheader')
    .map((th) => th.textContent);
const cells = (row: HTMLElement) => within(row).getAllByRole('cell');

describe('RFC-62 R8 TraitSpeciesTable in `with` mode', () => {
  it('names the species, its family, its records and the value a curator accepted', async () => {
    const { rows } = await renderTable([TRAIT_SPECIES_WITH_DATA], 'with');
    expect(headers(rows[0] as HTMLElement)).toEqual([
      'Species',
      'Family',
      'Records',
      'Accepted value',
      'Source',
    ]);
    const row = cells(rows[1] as HTMLElement);
    expect(
      within(row[0] as HTMLElement).getByRole('link', { name: 'Adenanthera pavonina' }),
    ).toHaveAttribute('href', `/app/species/${TRAIT_SPECIES_WITH_DATA.id}`);
    expect(row[1]).toHaveTextContent('Fabaceae');
    expect(row[2]).toHaveTextContent('4');
    // The levels this species has values on, in the order the API sent them.
    expect(row[2]).toHaveTextContent('dioecious 3 · hermaphrodite 1');
    expect(row[3]).toHaveTextContent('dioecious');
    expect(within(row[4] as HTMLElement).getByRole('link', { name: 'Renner2014' })).toHaveAttribute(
      'href',
      `/app/references/${TRAIT_SPECIES_WITH_DATA.accepted?.reference.id}`,
    );
  });

  it('dashes the family, the accepted value and its source when there is none', async () => {
    const { rows } = await renderTable(
      [{ ...TRAIT_SPECIES_UNDECIDED, family: null }],
      'with',
      'mg',
    );
    const row = cells(rows[1] as HTMLElement);
    expect(row[1]).toHaveTextContent('—');
    expect(row[3]).toHaveTextContent('—');
    expect(row[4]).toHaveTextContent('—');
    expect(within(row[4] as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  });

  it('takes the numeric summary from the trait unit, and reads the span bare without one', async () => {
    const first = await renderTable([TRAIT_SPECIES_UNDECIDED], 'with', 'mg');
    expect(cells(first.rows[1] as HTMLElement)[2]).toHaveTextContent('0.5 – 3 mg');
    first.unmount();

    const second = await renderTable([TRAIT_SPECIES_UNDECIDED], 'with');
    // The count and the summary are stacked spans, so the cell's own text is
    // the two run together: one record, spanning 0.5 to 3 of nothing named.
    expect(cells(second.rows[1] as HTMLElement)[2]?.textContent).toBe('10.5 – 3');
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
