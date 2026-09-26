import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SortTh, Table, Thead, Tr } from './Table.tsx';

const inTable = (th: ReactElement) => (
  <Table>
    <Thead>
      <Tr>{th}</Tr>
    </Thead>
  </Table>
);

describe('RFC-13 R5 SortTh', () => {
  it('is a column header holding a button; aria-sort follows the direction', async () => {
    const onSort = vi.fn();
    const { rerender } = render(inTable(<SortTh label="Value" direction={null} onSort={onSort} />));
    expect(screen.getByRole('columnheader', { name: 'Value' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Value' }));
    expect(onSort).toHaveBeenCalledTimes(1);
    rerender(inTable(<SortTh label="Value" direction="asc" onSort={onSort} />));
    expect(screen.getByRole('columnheader', { name: 'Value' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    rerender(inTable(<SortTh label="Value" direction="desc" onSort={onSort} />));
    expect(screen.getByRole('columnheader', { name: 'Value' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });
});
