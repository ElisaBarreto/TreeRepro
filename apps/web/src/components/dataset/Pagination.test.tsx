import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Pager } from '../../lib/use-paged-list.ts';
import { Pagination } from './Pagination.tsx';

function pager(overrides: Partial<Pager> = {}): Pager {
  return {
    page: 1,
    pageSize: 50,
    hasPrev: false,
    hasNext: false,
    prev: vi.fn(),
    next: vi.fn(),
    setPageSize: vi.fn(),
    ...overrides,
  };
}

describe('RFC-11 R6 Pagination', () => {
  it('names the page, offers the three sizes and disables the steps that are unavailable', () => {
    render(<Pagination pager={pager()} />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    const select = screen.getByLabelText('Rows per page');
    expect(select).toHaveValue('50');
    expect(
      screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value),
    ).toEqual(['25', '50', '100']);
  });

  it('steps forward and back through the pager and hands over a chosen size as a number', async () => {
    const controls = pager({ page: 3, pageSize: 25, hasPrev: true, hasNext: true });
    render(<Pagination pager={controls} />);
    expect(screen.getByText('Page 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Rows per page')).toHaveValue('25');

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(controls.prev).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(controls.next).toHaveBeenCalledTimes(1);
    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '100');
    expect(controls.setPageSize).toHaveBeenCalledWith(100);
  });
});
