import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CONTRIBUTION_ANNOTATION,
  GENERATED_CONTRIBUTION_ANNOTATION,
  PRIMARY_REFERENCE,
} from '../../test/dataset-fixtures.ts';
import { AnnotationTable } from './AnnotationTable.tsx';

// The reference column is a router `Link`, so the table mounts inside a
// minimal router whose only page is the table itself.
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

// The router renders its route asynchronously, so every test waits for
// the table before reading it.
const rows = async () => screen.findAllByRole('row');

describe('RFC-71 R3 AnnotationTable', () => {
  it('lists the kind, the date, species and trait, the note and the supporting reference', async () => {
    const onSelect = vi.fn();
    renderInRouter(
      <AnnotationTable
        annotations={[CONTRIBUTION_ANNOTATION, GENERATED_CONTRIBUTION_ANNOTATION]}
        onSelect={onSelect}
      />,
    );
    const headers = (await screen.findAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toEqual(['Annotated', 'Kind', 'Record', 'Note', 'Support']);

    const first = (await rows())[1] as HTMLElement;
    expect(within(first).getByText('confirm')).toBeInTheDocument();
    expect(first).toHaveTextContent('Matches the herbarium sheet.');
    const record = within(first).getByRole('button', {
      name: 'Adenanthera pavonina › sexual system',
    });
    const reference = within(first).getByRole('link', { name: 'Renner2014' });
    expect(reference).toHaveAttribute('href', `/app/references/${PRIMARY_REFERENCE.id}`);
    expect(first).toHaveTextContent('supported by Renner2014');

    await userEvent.click(record);
    expect(onSelect).toHaveBeenCalledWith(CONTRIBUTION_ANNOTATION);
  });

  it('reads a generated annotation as "automatic"', async () => {
    renderInRouter(
      <AnnotationTable
        annotations={[CONTRIBUTION_ANNOTATION, GENERATED_CONTRIBUTION_ANNOTATION]}
        onSelect={vi.fn()}
      />,
    );
    const listed = await rows();
    expect(within(listed[1] as HTMLElement).queryByText('automatic')).not.toBeInTheDocument();
    const generated = listed[2] as HTMLElement;
    expect(within(generated).getByText('dispute')).toBeInTheDocument();
    expect(within(generated).getByText('automatic')).toBeInTheDocument();
  });

  it('dates the row by the annotation, not by the record it annotates', async () => {
    renderInRouter(<AnnotationTable annotations={[CONTRIBUTION_ANNOTATION]} onSelect={vi.fn()} />);
    const row = (await rows())[1] as HTMLElement;
    const cell = within(row).getAllByRole('cell')[0] as HTMLElement;
    // The annotation was written on the 8th; RECORD, which it annotates, was
    // added on the 1st (RFC-71 R3).
    expect(cell).toHaveTextContent('2026-09-08');
    expect(within(cell).getByText('2026-09-08')).toHaveAttribute(
      'datetime',
      CONTRIBUTION_ANNOTATION.createdAt,
    );
    expect(row).not.toHaveTextContent('2026-09-01');
  });

  it('shows a dash where an annotation has no note and no reference', async () => {
    renderInRouter(
      <AnnotationTable annotations={[GENERATED_CONTRIBUTION_ANNOTATION]} onSelect={vi.fn()} />,
    );
    const cells = within((await rows())[1] as HTMLElement).getAllByRole('cell');
    expect(cells[4]).toHaveTextContent(/^—$/);
    expect(within(cells[4] as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  });
});
