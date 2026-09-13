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
  it('lists the first page at once and searches again once two letters settle', async () => {
    dataset.searchReferences.mockResolvedValue(page([REFERENCE, BARE]));
    await openPage();
    const link = await screen.findByRole('link', { name: 'Smith2001' });
    expect(dataset.searchReferences).toHaveBeenCalledWith({
      q: undefined,
      cursor: undefined,
      limit: 50,
    });
    expect(dataset.searchReferences).toHaveBeenCalledTimes(1);
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
    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('Page 1')).toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeDisabled();

    // One letter is below the API's minimum and asks for nothing new.
    await userEvent.type(screen.getByLabelText('Search references'), 's');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(dataset.searchReferences).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText('Search references'), 'm');
    await waitFor(() =>
      expect(dataset.searchReferences).toHaveBeenLastCalledWith({
        q: 'sm',
        cursor: undefined,
        limit: 50,
      }),
    );
    expect(dataset.searchReferences).toHaveBeenCalledTimes(2);
  });

  it('says so when nothing matches, and only once the page arrived', async () => {
    let resolvePage: (value: ReturnType<typeof page>) => void = () => {};
    dataset.searchReferences.mockReturnValue(
      new Promise<ReturnType<typeof page>>((resolve) => {
        resolvePage = resolve;
      }),
    );
    await openPage();
    expect(screen.getByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByText('No references match.')).not.toBeInTheDocument();

    resolvePage(page([]));
    expect(await screen.findByText('No references match.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('steps to the next page with the cursor and back to the first', async () => {
    dataset.searchReferences
      .mockResolvedValueOnce(page([REFERENCE], 'c1'))
      .mockResolvedValueOnce(page([BARE]))
      .mockResolvedValue(page([REFERENCE], 'c1'));
    await openPage();
    expect(await screen.findByRole('link', { name: 'Smith2001' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByRole('link')).toHaveAttribute(
        'href',
        `/app/references/${BARE.id}`,
      ),
    );
    expect(dataset.searchReferences).toHaveBeenLastCalledWith({
      q: undefined,
      cursor: 'c1',
      limit: 50,
    });
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByRole('link', { name: 'Smith2001' })).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    dataset.searchReferences.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(screen.queryByText('No references match.')).not.toBeInTheDocument();
    first.unmount();

    dataset.searchReferences.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });
});
