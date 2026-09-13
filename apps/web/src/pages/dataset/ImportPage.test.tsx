import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportReject, MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { IMPORT_BATCH, IMPORT_REJECT } from '../../test/dataset-fixtures.ts';
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
const dataset = vi.hoisted(() => ({ fetchImport: vi.fn(), fetchImportRejects: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const OPERATOR: MeResponse = { ...ME, permissions: ['dataset.read', 'imports.read'] };
const NO_REFERENCE: ImportReject = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c9102',
  rowNo: 1200,
  reason: 'no_reference',
  rawRow: { ...IMPORT_REJECT.rawRow, primary_reference: '', final_standard_trait: 'seed_mass' },
};
const page = (data: ImportReject[], nextCursor: string | null = null) => ({
  data,
  meta: { nextCursor },
});
const PATH = `/app/imports/${IMPORT_BATCH.id}`;

beforeEach(() => {
  auth.fetchMe.mockReset();
  dataset.fetchImport.mockReset();
  dataset.fetchImportRejects.mockReset();
  auth.fetchMe.mockResolvedValue(OPERATOR);
  dataset.fetchImport.mockResolvedValue(IMPORT_BATCH);
  dataset.fetchImportRejects.mockResolvedValue(page([IMPORT_REJECT, NO_REFERENCE]));
});

describe('RFC-13 R2, RFC-64 R11 ImportPage', () => {
  it('shows the file, status, counts, unknown levels and the rejected rows', async () => {
    renderAt(PATH);
    expect(await screen.findByRole('heading', { name: 'records-2026-09.csv' })).toBeInTheDocument();
    expect(dataset.fetchImport).toHaveBeenCalledWith(IMPORT_BATCH.id);
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(
      screen.getByText('Started 2026-09-13 10:15 · finished 2026-09-13 10:42 · run by Ada'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const terms = screen.getAllByRole('term').map((term) => term.textContent);
    expect(terms.slice(0, 5)).toEqual(['Total', 'Inserted', 'Duplicate', 'Rejected', 'Pending']);
    const definitions = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(definitions.slice(0, 5)).toEqual(['12,345', '12,000', '300', '45', '210']);

    const unknown = screen.getByRole('heading', { name: 'Unknown levels' }).closest('section');
    const unknownRows = within(unknown as HTMLElement).getAllByRole('row');
    expect(unknownRows).toHaveLength(2);
    expect(unknownRows[1]).toHaveTextContent('pollination_syndrome');
    expect(unknownRows[1]).toHaveTextContent('bees');
    expect(unknownRows[1]).toHaveTextContent('17');

    const rejected = screen.getByRole('heading', { name: 'Rejected rows' }).closest('section');
    const rows = await within(rejected as HTMLElement).findAllByRole('row');
    expect(dataset.fetchImportRejects).toHaveBeenCalledWith(IMPORT_BATCH.id, {
      cursor: undefined,
      limit: 50,
    });
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('42');
    expect(rows[1]).toHaveTextContent('Unknown trait');
    expect(rows[2]).toHaveTextContent('1200');
    expect(rows[2]).toHaveTextContent('No reference');

    const details = within(rows[1] as HTMLElement)
      .getByText('Raw row')
      .closest('details');
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(within(rows[1] as HTMLElement).getByText('Raw row'));
    expect(details).toHaveAttribute('open');
    const columns = within(details as HTMLElement)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(columns).toEqual([
      'primary_reference',
      'secondary_reference',
      'wcvp_species',
      'wcvp_genus',
      'wcvp_family',
      'gbif_species',
      'gbif_usage_key',
      'original_species_name',
      'secondary_source_species_name',
      'original_trait_name',
      'final_standard_trait',
      'broad_category',
      'original_value_clean',
      'trait_value_type',
      'harmonised_value',
    ]);
    const values = within(details as HTMLElement)
      .getAllByRole('definition')
      .map((d) => d.textContent);
    expect(values[0]).toBe('Smith2001');
    expect(values[1]).toBe('—');
    expect(values[10]).toBe('flower_hue');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says "None" when there are no unknown levels and no rejected rows', async () => {
    dataset.fetchImport.mockResolvedValue({ ...IMPORT_BATCH, unknownLevels: [], rowsRejected: 0 });
    dataset.fetchImportRejects.mockResolvedValue(page([]));
    renderAt(PATH);
    await screen.findByRole('heading', { name: 'records-2026-09.csv' });
    const unknown = screen.getByRole('heading', { name: 'Unknown levels' }).closest('section');
    expect(within(unknown as HTMLElement).getByText('None')).toBeInTheDocument();
    const rejected = screen.getByRole('heading', { name: 'Rejected rows' }).closest('section');
    expect(await within(rejected as HTMLElement).findByText('None')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the error of a failed batch, and an operator without a name as a dash', async () => {
    dataset.fetchImport.mockResolvedValue({
      ...IMPORT_BATCH,
      status: 'failed',
      runBy: null,
      finishedAt: null,
      error: 'header mismatch',
    });
    dataset.fetchImportRejects.mockResolvedValue(page([]));
    renderAt(PATH);
    await screen.findByRole('heading', { name: 'records-2026-09.csv' });
    expect(screen.getByRole('alert')).toHaveTextContent('This import failed: header mismatch');
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('Started 2026-09-13 10:15 · run by —')).toBeInTheDocument();
  });

  it('a missing batch says so and asks for no rejects', async () => {
    dataset.fetchImport.mockRejectedValue(new ApiError(404, 'IMPORT_NOT_FOUND', 'x'));
    renderAt(PATH);
    expect(await screen.findByRole('alert')).toHaveTextContent('This import does not exist.');
    expect(screen.getByRole('heading', { name: 'Import' })).toBeInTheDocument();
    expect(dataset.fetchImportRejects).not.toHaveBeenCalled();
  });

  it('RFC-13 R3 without imports.read the route shows NoPermission and calls nothing', async () => {
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read'] });
    renderAt(PATH);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this area.',
    );
    expect(dataset.fetchImport).not.toHaveBeenCalled();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    dataset.fetchImport.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = renderAt(PATH);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    first.unmount();

    dataset.fetchImport.mockResolvedValue(IMPORT_BATCH);
    dataset.fetchImportRejects.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderAt(PATH);
    await screen.findByRole('heading', { name: 'records-2026-09.csv' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});
