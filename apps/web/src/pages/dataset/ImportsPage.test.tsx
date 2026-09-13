import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportBatch, MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { IMPORT_BATCH } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
}));
const dataset = vi.hoisted(() => ({ fetchImports: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const OPERATOR: MeResponse = { ...ME, permissions: ['dataset.read', 'imports.read'] };
const FAILED: ImportBatch = {
  ...IMPORT_BATCH,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c9002',
  fileName: 'records-broken.csv',
  status: 'failed',
  runBy: null,
  startedAt: '2026-09-12T23:59:00.000Z',
  finishedAt: '2026-09-12T23:59:30.000Z',
  rowsTotal: 0,
  rowsInserted: 0,
  rowsDuplicate: 0,
  rowsRejected: 0,
  rowsPending: 0,
  unknownLevels: [],
  error: 'header mismatch',
};
const page = (data: ImportBatch[], nextCursor: string | null = null) => ({
  data,
  meta: { nextCursor },
});

beforeEach(() => {
  auth.fetchMe.mockReset();
  dataset.fetchImports.mockReset();
  auth.fetchMe.mockResolvedValue(OPERATOR);
});

describe('RFC-13 R2, RFC-64 R11 ImportsPage', () => {
  it('lists the batches with their status, start, operator and counts', async () => {
    dataset.fetchImports.mockResolvedValue(page([IMPORT_BATCH, FAILED]));
    renderAt('/app/imports');
    expect(await screen.findByRole('heading', { name: 'Imports' })).toBeInTheDocument();

    const link = await screen.findByRole('link', { name: 'records-2026-09.csv' });
    expect(link).toHaveAttribute('href', `/app/imports/${IMPORT_BATCH.id}`);
    expect(dataset.fetchImports).toHaveBeenCalledWith({ cursor: undefined, limit: 50 });
    expect(dataset.fetchImports).toHaveBeenCalledTimes(1);

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const completed = rows[1] as HTMLElement;
    expect(within(completed).getByText('completed')).toBeInTheDocument();
    expect(within(completed).getByText('2026-09-13 10:15')).toHaveAttribute(
      'datetime',
      IMPORT_BATCH.startedAt,
    );
    expect(completed).toHaveTextContent('Ada');
    const cells = within(completed)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells.slice(4)).toEqual(['12,345', '12,000', '300', '45', '210']);

    const failed = rows[2] as HTMLElement;
    expect(within(failed).getByText('failed')).toBeInTheDocument();
    expect(within(failed).getByText('2026-09-12 23:59')).toBeInTheDocument();
    expect(within(failed).getByText('—')).toBeInTheDocument();
    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('Page 1')).toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('says so when nothing was imported yet', async () => {
    dataset.fetchImports.mockResolvedValue(page([]));
    renderAt('/app/imports');
    expect(await screen.findByText('No imports yet.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('steps to the next page with the cursor and back to the first', async () => {
    dataset.fetchImports
      .mockResolvedValueOnce(page([IMPORT_BATCH], 'c1'))
      .mockResolvedValueOnce(page([FAILED]))
      .mockResolvedValue(page([IMPORT_BATCH], 'c1'));
    renderAt('/app/imports');
    expect(await screen.findByRole('link', { name: 'records-2026-09.csv' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('link', { name: 'records-broken.csv' })).toBeInTheDocument();
    expect(dataset.fetchImports).toHaveBeenLastCalledWith({ cursor: 'c1', limit: 50 });
    expect(screen.queryByRole('link', { name: 'records-2026-09.csv' })).not.toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByRole('link', { name: 'records-2026-09.csv' })).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('RFC-13 R3 without imports.read the route shows NoPermission and the nav hides Imports', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read'] });
    renderAt('/app/imports');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this area.',
    );
    expect(screen.queryByRole('heading', { name: 'Imports' })).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Data' });
    expect(within(nav).queryByRole('link', { name: 'Imports' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Species' })).toBeInTheDocument();
    expect(dataset.fetchImports).not.toHaveBeenCalled();
  });

  it('RFC-13 R3 with imports.read the nav shows Imports', async () => {
    dataset.fetchImports.mockResolvedValue(page([]));
    renderAt('/app/imports');
    await screen.findByRole('heading', { name: 'Imports' });
    const nav = screen.getByRole('navigation', { name: 'Data' });
    expect(within(nav).getByRole('link', { name: 'Imports' })).toHaveAttribute(
      'href',
      '/app/imports',
    );
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    dataset.fetchImports.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = renderAt('/app/imports');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    first.unmount();

    dataset.fetchImports.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderAt('/app/imports');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.'),
    );
  });
});
