import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse, RecordItem, ReferenceDetail } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import {
  PENDING_RECORD,
  PERSONAL_OBSERVATION_DETAIL,
  RECORD,
  RECORD_DETAIL,
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
const dataset = vi.hoisted(() => ({
  fetchReference: vi.fn(),
  fetchRecords: vi.fn(),
  fetchRecord: vi.fn(),
}));
const catalog = vi.hoisted(() => ({ updateReference: vi.fn() }));
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
const SMITH = {
  id: REFERENCE.id,
  citationKey: REFERENCE.citationKey,
  kind: REFERENCE.kind,
  observer: REFERENCE.observer,
  shortCitation: REFERENCE.shortCitation,
};
// The records of this page name Smith2001 as primary or secondary source.
const PRIMARY: RecordItem = { ...RECORD, primaryReference: SMITH, secondaryReference: null };
const SECONDARY: RecordItem = { ...PENDING_RECORD, secondaryReference: SMITH };
const BARE: ReferenceDetail = {
  ...REFERENCE_DETAIL,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f02',
  citationKey: `Smithsonian${'x'.repeat(80)}2002`,
  title: null,
  authors: null,
  year: null,
  journal: null,
  doi: null,
  url: null,
  recordCount: 1,
  primaryCount: 1,
  secondaryCount: 0,
};
const page = (data: RecordItem[], nextCursor: string | null = null) => ({
  data,
  meta: { nextCursor },
});

beforeEach(() => {
  auth.fetchMe.mockReset();
  catalog.updateReference.mockReset();
  dataset.fetchReference.mockReset();
  dataset.fetchRecords.mockReset();
  dataset.fetchRecord.mockReset();
  auth.fetchMe.mockResolvedValue(READER);
  dataset.fetchReference.mockResolvedValue(REFERENCE_DETAIL);
  dataset.fetchRecords.mockResolvedValue(page([PRIMARY, SECONDARY]));
  dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
});

async function openPage(reference: ReferenceDetail = REFERENCE_DETAIL) {
  const utils = renderAt(`/app/references/${reference.id}`);
  expect(
    await screen.findByRole('heading', { level: 1, name: reference.citationKey }),
  ).toBeInTheDocument();
  return utils;
}

function definition(label: string): HTMLElement {
  const dd = screen.getByText(label, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`no <dd> after ${label}`);
  return dd;
}

describe('RFC-61 R4 ReferencePage metadata', () => {
  it('shows the citation key, the usage per role and every field, DOI and URL as links', async () => {
    await openPage();
    expect(dataset.fetchReference).toHaveBeenCalledWith(REFERENCE.id);
    expect(
      screen.getByText(
        'Used as the primary article in 1 record and as the secondary article in 1 record.',
      ),
    ).toBeInTheDocument();
    expect(definition('Title')).toHaveTextContent('Breeding systems of tropical trees');
    expect(definition('Authors')).toHaveTextContent('Smith, J.; Doe, A.');
    expect(definition('Year')).toHaveTextContent('2001');
    expect(definition('Journal')).toHaveTextContent('Journal of Tropical Ecology');
    const doi = within(definition('DOI')).getByRole('link', { name: '10.1000/jte.2001.1' });
    expect(doi).toHaveAttribute('href', 'https://doi.org/10.1000/jte.2001.1');
    expect(doi).toHaveAttribute('rel', 'noreferrer');
    const url = within(definition('URL')).getByRole('link', {
      name: 'https://example.org/smith2001',
    });
    expect(url).toHaveAttribute('href', 'https://example.org/smith2001');
    expect(url).toHaveAttribute('rel', 'noreferrer');
  });

  it('pluralises each count on its own and separates thousands', async () => {
    dataset.fetchReference.mockResolvedValue({
      ...REFERENCE_DETAIL,
      recordCount: 1240,
      primaryCount: 1237,
      secondaryCount: 3,
    });
    await openPage();
    expect(
      screen.getByText(
        'Used as the primary article in 1,237 records and as the secondary article in 3 records.',
      ),
    ).toBeInTheDocument();
  });

  it('reads "—" for every missing field, keeps a long key whole and counts zero in the plural', async () => {
    dataset.fetchReference.mockResolvedValue(BARE);
    dataset.fetchRecords.mockResolvedValue(page([PRIMARY]));
    await openPage(BARE);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(BARE.citationKey);
    expect(
      screen.getByText(
        'Used as the primary article in 1 record and as the secondary article in 0 records.',
      ),
    ).toBeInTheDocument();
    for (const label of ['Title', 'Authors', 'Year', 'Journal', 'DOI', 'URL']) {
      expect(definition(label)).toHaveTextContent('—');
    }
    expect(within(definition('DOI')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('RFC-61 R7 names a personal observation after its observer, never by its key', async () => {
    dataset.fetchReference.mockResolvedValue(PERSONAL_OBSERVATION_DETAIL);
    dataset.fetchRecords.mockResolvedValue(page([PRIMARY]));
    renderAt(`/app/references/${PERSONAL_OBSERVATION_DETAIL.id}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Personal observation (Ada)' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(PERSONAL_OBSERVATION_DETAIL.citationKey)).not.toBeInTheDocument();
  });

  it('shows the URL as plain text when it is not an http(s) address', async () => {
    dataset.fetchReference.mockResolvedValue({ ...REFERENCE_DETAIL, url: 'example.org/smith2001' });
    dataset.fetchRecords.mockResolvedValue(page([PRIMARY]));
    await openPage();
    const urlField = definition('URL');
    expect(urlField).toHaveTextContent('example.org/smith2001');
    expect(within(urlField).queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('RFC-63 R8, R9 ReferencePage records', () => {
  it('lists the records with the species, trait, primary and secondary article per row, both chips, and opens the drawer from a row', async () => {
    await openPage();
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenCalledWith({
        referenceId: REFERENCE.id,
        cursor: undefined,
        limit: 50,
      }),
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Records citing this article',
    );
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const headers = within(rows[0] as HTMLElement)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers.slice(0, 5)).toEqual([
      'Species',
      'Trait',
      'Value',
      'Primary article',
      'Secondary article',
    ]);
    const species = within(rows[1] as HTMLElement).getByRole('link', {
      name: 'Adenanthera pavonina',
    });
    expect(species).toHaveAttribute('href', `/app/species/${RECORD.species.id}`);
    const first = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(first[1]).toHaveTextContent('sexual system');
    expect(
      within(first[3] as HTMLElement).getByRole('link', { name: 'Smith2001' }),
    ).toHaveAttribute('href', `/app/references/${REFERENCE.id}`);
    expect(first[4]).toHaveTextContent(/^—$/);
    expect(within(rows[1] as HTMLElement).getByText('harmonised')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('confirmed')).toBeInTheDocument();
    const second = within(rows[2] as HTMLElement).getAllByRole('cell');
    expect(second[1]).toHaveTextContent('seed mass');
    expect(
      within(second[3] as HTMLElement).getByRole('link', { name: 'Renner2014' }),
    ).toBeVisible();
    expect(within(second[4] as HTMLElement).getByRole('link', { name: 'Smith2001' })).toBeVisible();
    expect(within(rows[2] as HTMLElement).getByText('not a number')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('disputed')).toBeInTheDocument();
    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('Page 1')).toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'dioecious' }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'Record' });
    await waitFor(() => expect(dataset.fetchRecord).toHaveBeenCalledWith(RECORD.id));
    expect(await within(drawer).findByText('Dioecious')).toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('RFC-65 R7 follows a harmonisation link inside the drawer to the linked record', async () => {
    dataset.fetchRecord.mockImplementation(async (id: string) =>
      id === RECORD.id
        ? { ...RECORD_DETAIL, supersededBy: [{ id: PENDING_RECORD.id }] }
        : { ...RECORD_DETAIL, id: PENDING_RECORD.id, valueText: 'about two', rawValue: null },
    );
    await openPage();
    await userEvent.click(await screen.findByRole('button', { name: 'dioecious' }));
    const drawer = await screen.findByRole('dialog', { name: 'Record' });
    await userEvent.click(
      await within(drawer).findByRole('button', { name: /^Harmonised as record …/ }),
    );
    await waitFor(() => expect(dataset.fetchRecord).toHaveBeenCalledWith(PENDING_RECORD.id));
    expect(await within(drawer).findByText('about two')).toBeInTheDocument();
  });

  it('steps to the next page of records with the cursor and back', async () => {
    dataset.fetchRecords
      .mockResolvedValueOnce(page([PRIMARY], 'c1'))
      .mockResolvedValueOnce(page([SECONDARY]))
      .mockResolvedValue(page([PRIMARY], 'c1'));
    await openPage();
    expect(await screen.findByRole('button', { name: 'dioecious' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('button', { name: 'about two' })).toBeInTheDocument();
    expect(dataset.fetchRecords).toHaveBeenLastCalledWith({
      referenceId: REFERENCE.id,
      cursor: 'c1',
      limit: 50,
    });
    expect(screen.queryByRole('button', { name: 'dioecious' })).not.toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByRole('button', { name: 'dioecious' })).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('says so when no record cites the article', async () => {
    dataset.fetchRecords.mockResolvedValue(page([]));
    await openPage();
    expect(await screen.findByText('No records cite this article yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });
});

describe('RFC-13 R4, R6 ReferencePage errors', () => {
  it('a rejected id (VALIDATION_FAILED) reads as not found', async () => {
    dataset.fetchReference.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'x', [{ path: 'id', message: 'x' }]),
    );
    renderAt('/app/references/not-a-uuid');
    expect(await screen.findByRole('alert')).toHaveTextContent('This reference does not exist.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('REFERENCE_NOT_FOUND renders the not-found alert and nothing else', async () => {
    dataset.fetchReference.mockRejectedValue(new ApiError(404, 'REFERENCE_NOT_FOUND', 'x'));
    renderAt(`/app/references/${REFERENCE.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('This reference does not exist.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reference');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText('No records cite this article yet.')).not.toBeInTheDocument();
    expect(dataset.fetchRecords).not.toHaveBeenCalled();
  });

  it('a 403 shows the permission sentence; another failure the generic one', async () => {
    dataset.fetchReference.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = renderAt(`/app/references/${REFERENCE.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    first.unmount();

    dataset.fetchReference.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderAt(`/app/references/${REFERENCE.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('a 403 on the records alone is shown in the records section under the metadata', async () => {
    dataset.fetchRecords.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(definition('Title')).toHaveTextContent('Breeding systems of tropical trees');
    expect(screen.queryByText('No records cite this article yet.')).not.toBeInTheDocument();
  });
});

describe('RFC-61 R6 ReferencePage editor', () => {
  it('offers "Edit" to references.manage; a saved edit re-renders the detail', async () => {
    auth.fetchMe.mockResolvedValue(LIBRARIAN);
    dataset.fetchReference
      .mockResolvedValueOnce(REFERENCE_DETAIL)
      .mockResolvedValue({ ...REFERENCE_DETAIL, title: 'New title' });
    catalog.updateReference.mockResolvedValue({ ...REFERENCE_DETAIL, title: 'New title' });
    renderAt(`/app/references/${REFERENCE_DETAIL.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit reference' });
    const title = within(dialog).getByRole('textbox', { name: /^title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'New title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('New title')).toBeInTheDocument();
  });
});

describe('RFC-13 R3 ReferencePage breadcrumb', () => {
  it('registers the reference label as the last crumb of Data › References', async () => {
    await openPage();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText(REFERENCE_DETAIL.citationKey)).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(trail).getByRole('link', { name: 'References' })).toHaveAttribute(
      'href',
      '/app/references',
    );
    expect(trail).toHaveTextContent('Data');
  });
});
