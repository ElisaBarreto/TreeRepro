import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse, Reference } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { REFERENCE } from '../../test/dataset-fixtures.ts';
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
const dataset = vi.hoisted(() => ({ searchReferences: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };
const LONG_KEY = `Smithsonian${'x'.repeat(80)}2002`;
const BARE: Reference = {
  ...REFERENCE,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f02',
  citationKey: LONG_KEY,
  title: null,
  year: null,
  journal: null,
};
const page = (data: Reference[], nextCursor: string | null = null) => ({
  data,
  meta: { nextCursor },
});

beforeEach(() => {
  auth.fetchMe.mockReset();
  dataset.searchReferences.mockReset();
  auth.fetchMe.mockResolvedValue(READER);
});

async function openPage() {
  const utils = renderAt('/app/references');
  expect(await screen.findByRole('heading', { name: 'References' })).toBeInTheDocument();
  return utils;
}

describe('RFC-13 R2, RFC-61 R4 ReferencesPage', () => {
  it('waits for two letters, searches once the typing settles and lists the rows', async () => {
    dataset.searchReferences.mockResolvedValue(page([REFERENCE, BARE]));
    await openPage();
    expect(screen.getByText('Type at least two letters to search references.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search references'), 's');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(dataset.searchReferences).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Search references'), 'm');
    await waitFor(() =>
      expect(dataset.searchReferences).toHaveBeenCalledWith({
        q: 'sm',
        cursor: undefined,
        limit: 50,
      }),
    );
    expect(dataset.searchReferences).toHaveBeenCalledTimes(1);

    const link = await screen.findByRole('link', { name: 'Smith2001' });
    expect(link).toHaveAttribute('href', `/app/references/${REFERENCE.id}`);
    expect(link).not.toHaveAttribute('title');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Breeding systems of tropical trees');
    expect(rows[1]).toHaveTextContent('2001');
    expect(rows[1]).toHaveTextContent('Journal of Tropical Ecology');

    const truncated = within(rows[2] as HTMLElement).getByRole('link');
    expect(truncated).toHaveTextContent(`${LONG_KEY.slice(0, 79)}…`);
    expect(truncated).toHaveAttribute('title', LONG_KEY);
    expect(truncated).toHaveAttribute('href', `/app/references/${BARE.id}`);
    expect(within(rows[2] as HTMLElement).getAllByText('—')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    dataset.searchReferences.mockResolvedValue(page([]));
    await openPage();
    await userEvent.type(screen.getByLabelText('Search references'), 'zz');
    expect(await screen.findByText('No references match.')).toBeInTheDocument();
  });

  it('loads the next page with the cursor on "Load more"', async () => {
    dataset.searchReferences
      .mockResolvedValueOnce(page([REFERENCE], 'c1'))
      .mockResolvedValueOnce(page([BARE]));
    await openPage();
    await userEvent.type(screen.getByLabelText('Search references'), 'sm');
    expect(await screen.findByRole('link', { name: 'Smith2001' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3),
    );
    expect(dataset.searchReferences).toHaveBeenLastCalledWith({ q: 'sm', cursor: 'c1', limit: 50 });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    dataset.searchReferences.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = await openPage();
    await userEvent.type(screen.getByLabelText('Search references'), 'sm');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    first.unmount();

    dataset.searchReferences.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    await openPage();
    await userEvent.type(screen.getByLabelText('Search references'), 'sm');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});
