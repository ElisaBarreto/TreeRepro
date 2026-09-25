import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse, Reference } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  DICTIONARY,
  PERSONAL_OBSERVATION,
  REFERENCE,
  REFERENCE_DETAIL,
} from '../../test/dataset-fixtures.ts';
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
const catalog = vi.hoisted(() => ({ createReference: vi.fn() }));
const dataset = vi.hoisted(() => ({
  searchReferences: vi.fn(),
  fetchReference: vi.fn(),
  fetchDictionary: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };
const LIBRARIAN: MeResponse = { ...ME, permissions: ['dataset.read', 'references.manage'] };
const LONG_KEY = `Smithsonian${'x'.repeat(80)}2002`;
// A full citation pasted as the key, never cited.
const BARE: Reference = {
  ...REFERENCE,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f02',
  citationKey: LONG_KEY,
  title: null,
  year: null,
  journal: null,
  doi: null,
  primaryCount: 0,
  secondaryCount: 0,
};
const DOI_KEY: Reference = {
  ...REFERENCE,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f03',
  citationKey: '10.1111/geb.13640',
  title: null,
  year: 2023,
  primaryCount: 1234,
  secondaryCount: 0,
};
const NUMERIC_KEY: Reference = {
  ...REFERENCE,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f04',
  citationKey: '42',
  title: null,
  year: null,
  primaryCount: 0,
  secondaryCount: 3,
};
const page = (data: Reference[], nextCursor: string | null = null) => ({
  data,
  meta: { nextCursor },
});

beforeEach(() => {
  auth.fetchMe.mockReset();
  catalog.createReference.mockReset();
  dataset.searchReferences.mockReset();
  dataset.fetchReference.mockReset();
  dataset.fetchDictionary.mockReset();
  auth.fetchMe.mockResolvedValue(READER);
  dataset.fetchDictionary.mockResolvedValue(DICTIONARY);
  // Every filter test below drives the selects, not the list; a resolved
  // default keeps `usePagedList` from choking on an unmocked `undefined`.
  dataset.searchReferences.mockResolvedValue(page([]));
});

async function openPage() {
  const utils = renderAt('/app/references');
  expect(await screen.findByRole('heading', { name: 'References' })).toBeInTheDocument();
  return utils;
}

const cells = (row: HTMLElement) => within(row).getAllByRole('cell');

describe('RFC-13 R2, RFC-61 R4 ReferencesPage', () => {
  it('lists the first page at once, in the order the API sent, and searches again once two letters settle', async () => {
    dataset.searchReferences.mockResolvedValue(page([DOI_KEY, NUMERIC_KEY, REFERENCE, BARE]));
    await openPage();
    expect(
      screen.getByText(
        'Articles cited by the records, most used first. Search by citation key or title.',
      ),
    ).toBeInTheDocument();
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
    expect(rows).toHaveLength(5);
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Article', 'As primary', 'As secondary', 'Year', 'DOI / ISBN']);
    expect(
      rows
        .slice(1)
        .map(
          (row) =>
            within(cells(row as HTMLElement)[0] as HTMLElement).getByRole('link').textContent,
        ),
    ).toEqual(['10.1111/geb.13640', '42', 'Smith2001', `${LONG_KEY.slice(0, 79)}…`]);

    // Ordinary key: no badge; counts, year and the DOI link in their columns.
    const smith = cells(rows[3] as HTMLElement);
    expect(smith[0]).toHaveTextContent(/^Smith2001$/);
    expect(smith[1]).toHaveTextContent(/^1$/);
    expect(smith[2]).toHaveTextContent(/^1$/);
    expect(smith[3]).toHaveTextContent(/^2001$/);
    const smithDoi = within(smith[4] as HTMLElement).getByRole('link', {
      name: '10.1000/jte.2001.1',
    });
    expect(smithDoi).toHaveAttribute('href', 'https://doi.org/10.1000/jte.2001.1');
    expect(smithDoi).toHaveAttribute('target', '_blank');
    expect(smithDoi).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('Breeding systems of tropical trees')).not.toBeInTheDocument();

    const doi = cells(rows[1] as HTMLElement);
    expect(within(doi[0] as HTMLElement).getByText('DOI')).toBeInTheDocument();
    expect(doi[1]).toHaveTextContent(/^1,234$/);
    expect(doi[2]).toHaveTextContent(/^0$/);
    const numeric = cells(rows[2] as HTMLElement);
    expect(within(numeric[0] as HTMLElement).getByText('numeric index')).toBeInTheDocument();
    expect(numeric[2]).toHaveTextContent(/^3$/);

    const truncated = within(cells(rows[4] as HTMLElement)[0] as HTMLElement).getByRole('link');
    expect(truncated).toHaveTextContent(`${LONG_KEY.slice(0, 79)}…`);
    expect(truncated).toHaveAttribute('title', LONG_KEY);
    expect(truncated).toHaveAttribute('href', `/app/references/${BARE.id}`);
    expect(
      within(cells(rows[4] as HTMLElement)[0] as HTMLElement).getByText('full citation'),
    ).toBeInTheDocument();
    // BARE has no DOI: its dash and the year's dash, two in all.
    expect(within(rows[4] as HTMLElement).getAllByText('—')).toHaveLength(2);
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
    expect(screen.queryByText('No articles match.')).not.toBeInTheDocument();

    resolvePage(page([]));
    expect(await screen.findByText('No articles match.')).toBeInTheDocument();
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
    expect(screen.queryByText('No articles match.')).not.toBeInTheDocument();
    first.unmount();

    dataset.searchReferences.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('offers "New reference" to references.manage and navigates to the created reference', async () => {
    auth.fetchMe.mockResolvedValue(LIBRARIAN);
    catalog.createReference.mockResolvedValue(REFERENCE_DETAIL);
    dataset.fetchReference.mockResolvedValue(REFERENCE_DETAIL);
    const { router } = renderAt('/app/references');
    await userEvent.click(await screen.findByRole('button', { name: 'New reference' }));
    const dialog = screen.getByRole('dialog', { name: 'New reference' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /citation key/i }),
      'Smith2001',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create reference' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/app/references/${REFERENCE_DETAIL.id}`),
    );
  });

  it('hides "New reference" from a reader', async () => {
    // `openPage`, not a bare `findByText`: "References" also names the
    // sidebar entry and the breadcrumb, so only the heading disambiguates.
    await openPage();
    expect(screen.queryByRole('button', { name: 'New reference' })).not.toBeInTheDocument();
  });

  it('RFC-61 R10 shows a book by its citation, with its ISBN in the DOI / ISBN column', async () => {
    const book: Reference = {
      ...REFERENCE,
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f05',
      citationKey: 'isbn:9780306406157',
      kind: 'book',
      isbn: '9780306406157',
      title: null,
      doi: null,
      url: null,
      shortCitation: 'Doe, J. (2001). Seeds of the tropics.',
      fullCitation: 'Doe, J. (2001). Seeds of the tropics.',
    };
    dataset.searchReferences.mockResolvedValue(page([book]));
    await openPage();
    const link = await screen.findByRole('link', { name: 'Doe, J. (2001). Seeds of the tropics.' });
    const row = cells(link.closest('tr') as HTMLElement);
    expect(row[4]).toHaveTextContent(/^ISBN 9780306406157$/);
    expect(within(row[4] as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  });

  it('RFC-61 R10 never flags a book, however long its citation, as a pasted full citation', async () => {
    const citation = `Doe, J., Roe, R. and Poe, P. (2001). Seeds of the tropics: a field guide. Tropical Press.`;
    const book: Reference = {
      ...REFERENCE,
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f06',
      citationKey: 'isbn:9780306406157',
      kind: 'book',
      isbn: '9780306406157',
      doi: null,
      shortCitation: citation,
      fullCitation: citation,
    };
    dataset.searchReferences.mockResolvedValue(page([book]));
    await openPage();
    // The label is cut to fit; the whole citation is the link's title.
    const link = await screen.findByTitle(citation);
    expect(
      within(cells(link.closest('tr') as HTMLElement)[0] as HTMLElement).queryByText(
        'full citation',
      ),
    ).not.toBeInTheDocument();
  });
});

describe('RFC-61 R4 ReferencesPage category and trait filters', () => {
  it('seeds both selects from the URL and asks the API for the filtered references', async () => {
    const seedMassId = DICTIONARY[1]?.traits[0]?.id as string;
    renderAt(`/app/references?categoryKey=seed&traitId=${seedMassId}`);
    await screen.findByRole('option', { name: 'Reproductive system' });
    expect(screen.getByLabelText('Category')).toHaveValue('seed');
    expect(screen.getByLabelText('Trait')).toHaveValue(seedMassId);
    await waitFor(() =>
      expect(dataset.searchReferences).toHaveBeenCalledWith(
        expect.objectContaining({ categoryKey: 'seed', traitId: seedMassId }),
      ),
    );
    // The trait select only offers the chosen category's traits.
    const traitSelect = screen.getByLabelText('Trait');
    expect(within(traitSelect).getByRole('option', { name: 'seed mass' })).toBeInTheDocument();
    expect(
      within(traitSelect).queryByRole('option', { name: 'sexual system' }),
    ).not.toBeInTheDocument();
  });

  it('a ?traitId= deep link with no category derives one from the dictionary', async () => {
    const sexualSystemId = DICTIONARY[0]?.traits[0]?.id as string;
    renderAt(`/app/references?traitId=${sexualSystemId}`);
    await screen.findByRole('option', { name: 'Reproductive system' });
    expect(screen.getByLabelText('Category')).toHaveValue('reproductive_system');
    expect(screen.getByLabelText('Trait')).toHaveValue(sexualSystemId);
  });

  it('disables the trait select until a category is in force', async () => {
    await openPage();
    await screen.findByRole('option', { name: 'Seed' });
    expect(screen.getByLabelText('Trait')).toBeDisabled();
  });

  it('writes the chosen category into the URL and clears a trait that belonged to another one', async () => {
    const seedMassId = DICTIONARY[1]?.traits[0]?.id as string;
    const { router } = await openPage();
    await screen.findByRole('option', { name: 'Seed' });

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'seed');
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.objectContaining({ categoryKey: 'seed' }),
      ),
    );
    expect(router.state.location.search).toEqual(
      expect.not.objectContaining({ traitId: seedMassId }),
    );

    await userEvent.selectOptions(screen.getByLabelText('Trait'), seedMassId);
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.objectContaining({ categoryKey: 'seed', traitId: seedMassId }),
      ),
    );
    await waitFor(() =>
      expect(dataset.searchReferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ traitId: seedMassId }),
      ),
    );

    // Leaving the category behind drops the trait that belonged to it.
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'reproductive_system');
    await waitFor(() =>
      expect(router.state.location.search).toEqual(
        expect.not.objectContaining({ traitId: seedMassId }),
      ),
    );
  });
});

describe('RFC-61 R7 ReferencesPage personal observations', () => {
  it('names a personal observation after its observer, never by its key', async () => {
    dataset.searchReferences.mockResolvedValue(page([PERSONAL_OBSERVATION]));
    renderAt('/app/references');
    expect(
      await screen.findByRole('link', { name: 'Personal observation (Ada)' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(PERSONAL_OBSERVATION.citationKey)).not.toBeInTheDocument();
  });
});
