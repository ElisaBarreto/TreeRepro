import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse, RecordItem, SpeciesTraits } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { datasetKeys } from '../../api/dataset.ts';
import {
  ACCEPTED_STATE,
  CURATED_RECORD_DETAIL,
  DICTIONARY,
  EMPTY_ACCEPTED,
  FAMILIES,
  GENERA,
  PENDING_RECORD,
  PRIMARY_REFERENCE,
  RECORD,
  RECORD_DETAIL,
  REFERENCE,
  SEXUAL_SYSTEM,
  SEXUAL_SYSTEM_SUMMARY,
  SPECIES,
  SPECIES_TRAITS,
  UNRESOLVED_SPECIES,
} from '../../test/dataset-fixtures.ts';
import { ADMIN_ME, ME } from '../../test/fixtures.ts';
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
  fetchSpecies: vi.fn(),
  fetchSpeciesTraits: vi.fn(),
  fetchRecords: vi.fn(),
  fetchRecord: vi.fn(),
  fetchDictionary: vi.fn(),
  searchReferences: vi.fn(),
  fetchFamilies: vi.fn(),
  fetchGenera: vi.fn(),
}));
const catalog = vi.hoisted(() => ({ updateSpecies: vi.fn(), addSpeciesName: vi.fn() }));
// TraitPanel renders AcceptedSection, which calls fetchAccepted; mocked so
// the panel tests below do not hit the real apiFetch.
// `invalidateAfterRecordWrite` keeps the real signature so one test can
// swap the real implementation in.
const curation = vi.hoisted(() => ({
  createRecords: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(
    async (_queryClient: QueryClient, _speciesId?: string): Promise<void> => undefined,
  ),
  fetchAccepted: vi.fn(),
  setAccepted: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));
vi.mock('../../api/catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/catalog.ts')>()),
  ...catalog,
}));

const READER: MeResponse = { ...ME, permissions: ['dataset.read'] };
const CURATOR_TAXA: MeResponse = { ...ME, permissions: ['dataset.read', 'taxa.manage'] };
const page = (data: RecordItem[], nextCursor: string | null = null) => ({
  data,
  meta: { nextCursor },
});

beforeEach(() => {
  auth.fetchMe.mockReset();
  dataset.fetchSpecies.mockReset();
  dataset.fetchSpeciesTraits.mockReset();
  dataset.fetchRecords.mockReset();
  dataset.fetchRecord.mockReset();
  curation.fetchAccepted.mockReset().mockResolvedValue(EMPTY_ACCEPTED);
  dataset.fetchDictionary.mockReset();
  dataset.searchReferences.mockReset();
  dataset.fetchFamilies.mockReset().mockResolvedValue(FAMILIES);
  dataset.fetchGenera.mockReset().mockResolvedValue({ data: GENERA, meta: { nextCursor: null } });
  curation.createRecords.mockReset();
  curation.setAccepted.mockReset();
  curation.invalidateAfterRecordWrite.mockReset().mockResolvedValue(undefined);
  catalog.updateSpecies.mockReset();
  catalog.addSpeciesName.mockReset();
  auth.fetchMe.mockResolvedValue(READER);
  dataset.fetchSpecies.mockResolvedValue(SPECIES);
  dataset.fetchSpeciesTraits.mockResolvedValue(SPECIES_TRAITS);
  dataset.fetchRecords.mockResolvedValue(page([RECORD, PENDING_RECORD]));
  dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
  dataset.fetchDictionary.mockResolvedValue(DICTIONARY);
  dataset.searchReferences.mockResolvedValue({
    data: [{ ...REFERENCE, id: PRIMARY_REFERENCE.id, citationKey: PRIMARY_REFERENCE.citationKey }],
    meta: { nextCursor: null },
  });
});

async function openPage(species = SPECIES) {
  const utils = renderAt(`/app/species/${species.id}`);
  expect(
    await screen.findByRole('heading', { level: 1, name: new RegExp(species.canonicalName) }),
  ).toBeInTheDocument();
  return utils;
}

const ADD_ENTRIES = 'Add entries for another trait';

async function openTraitPanel() {
  await userEvent.click(screen.getByRole('button', { name: /^sexual system/ }));
  return screen.findByRole('dialog', { name: 'sexual system' });
}

describe('RFC-60 R7 SpeciesPage header', () => {
  it('shows the italic canonical name, the family › genus line, alternative names and counts', async () => {
    await openPage();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Adenanthera pavonina');
    expect(within(heading).getByText('Adenanthera pavonina').tagName).toBe('EM');
    expect(within(heading).queryByText('unresolved taxon')).not.toBeInTheDocument();
    expect(screen.getByText('Fabaceae › Adenanthera')).toBeInTheDocument();
    expect(screen.getByText('Adenanthera gersenii')).toBeInTheDocument();
    expect(screen.getByText('12 records · 3 traits')).toBeInTheDocument();
    expect(dataset.fetchSpecies).toHaveBeenCalledWith(SPECIES.id);
    expect(dataset.fetchSpeciesTraits).toHaveBeenCalledWith(SPECIES.id);
  });

  it('flags an unresolved taxon and says so when family and genus are unknown', async () => {
    dataset.fetchSpecies.mockResolvedValue(UNRESOLVED_SPECIES);
    dataset.fetchSpeciesTraits.mockResolvedValue([]);
    await openPage(UNRESOLVED_SPECIES);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Adansonia digitata');
    expect(within(heading).getByText('unresolved taxon')).toBeInTheDocument();
    expect(screen.getByText('unresolved taxonomy')).toBeInTheDocument();
    expect(screen.queryByText(/Also known as/)).not.toBeInTheDocument();
    expect(screen.getByText('0 records · 0 traits')).toBeInTheDocument();
    expect(screen.getByText('No trait records for this species yet.')).toBeInTheDocument();
  });

  it('RFC-33 R7 marks an inactive species after the unresolved taxon badge', async () => {
    dataset.fetchSpecies.mockResolvedValue({ ...SPECIES, active: false });
    await openPage({ ...SPECIES, active: false });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(within(heading).getByText('inactive')).toBeInTheDocument();
  });

  it('shows no inactive badge for an active species', async () => {
    await openPage();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(within(heading).queryByText('inactive')).not.toBeInTheDocument();
  });
});

describe('RFC-63 R10 SpeciesPage trait sections', () => {
  it('renders one section per category, in order, with a card per trait', async () => {
    await openPage();
    const sections = screen.getAllByRole('heading', { level: 2 });
    expect(sections.map((h) => h.textContent)).toEqual(['Sexual system', 'Pollination']);
    const cards = screen.getAllByRole('button', {
      name: /sexual system|pollination mode|seed mass/,
    });
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent(/^sexual system/);
    expect(cards[0]).toHaveTextContent('2 pending');
    expect(cards[1]).toHaveTextContent(/^pollination mode/);
    expect(cards[2]).toHaveTextContent(/^seed mass/);
    expect(cards[2]).toHaveTextContent('0.5 · 1.25 · 3 mg');
  });
});

describe('RFC-63 R8, R9 SpeciesPage trait panel and record drawer', () => {
  it('opens the panel for a card, lists the records with both chips, and closes it', async () => {
    await openPage();
    const panel = await openTraitPanel();
    await waitFor(() =>
      expect(dataset.fetchRecords).toHaveBeenCalledWith({
        speciesId: SPECIES.id,
        traitId: SEXUAL_SYSTEM.id,
        cursor: undefined,
        limit: 50,
      }),
    );
    expect(panel).toHaveTextContent('8 records');
    const rows = within(await within(panel).findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: 'dioecious' })).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Renner2014' })).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'TRY-6.0' })).toBeVisible();
    expect(rows[1]).toHaveTextContent('import');
    expect(within(rows[1] as HTMLElement).getByText('harmonised')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('confirmed')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('2026-09-01');
    expect(within(rows[2] as HTMLElement).getByRole('button', { name: 'about two' })).toBeVisible();
    expect(within(rows[2] as HTMLElement).getByText('not a number')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('disputed')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('manual');
    // The trait is the panel's title, so the rows do not repeat it.
    expect(within(rows[0] as HTMLElement).queryByText('Trait')).not.toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByText('Species')).not.toBeInTheDocument();
    const pagination = within(panel).getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('Page 1')).toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sexual system/ })).toHaveFocus();
  });

  it('steps to the next page of records with the cursor and back', async () => {
    dataset.fetchRecords
      .mockResolvedValueOnce(page([RECORD], 'c1'))
      .mockResolvedValueOnce(page([PENDING_RECORD]))
      .mockResolvedValue(page([RECORD], 'c1'));
    await openPage();
    const panel = await openTraitPanel();
    expect(await within(panel).findByRole('button', { name: 'dioecious' })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Next' }));
    expect(await within(panel).findByRole('button', { name: 'about two' })).toBeInTheDocument();
    expect(dataset.fetchRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ speciesId: SPECIES.id, traitId: SEXUAL_SYSTEM.id, cursor: 'c1' }),
    );
    expect(within(panel).queryByRole('button', { name: 'dioecious' })).not.toBeInTheDocument();
    expect(within(panel).getByText('Page 2')).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole('button', { name: 'Previous' }));
    expect(await within(panel).findByRole('button', { name: 'dioecious' })).toBeInTheDocument();
    expect(within(panel).getByText('Page 1')).toBeInTheDocument();
  });

  it('says so when a trait has no records', async () => {
    dataset.fetchRecords.mockResolvedValue(page([]));
    await openPage();
    const panel = await openTraitPanel();
    expect(await within(panel).findByText('No records for this trait yet.')).toBeInTheDocument();
    expect(within(panel).queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('opens the record drawer from a row: value, source links, provenance, raw columns, empty curation', async () => {
    await openPage();
    const panel = await openTraitPanel();
    await userEvent.click(await within(panel).findByRole('button', { name: 'dioecious' }));
    const drawer = await screen.findByRole('dialog', { name: 'Record' });
    await waitFor(() => expect(dataset.fetchRecord).toHaveBeenCalledWith(RECORD.id));
    expect(await within(drawer).findByText('Dioecious')).toBeInTheDocument();
    expect(within(drawer).getByText('Original trait name').nextElementSibling).toHaveTextContent(
      'Sexual System',
    );
    expect(
      within(drawer).getByText('Secondary source species name').nextElementSibling,
    ).toHaveTextContent('—');
    expect(within(drawer).getByRole('link', { name: 'Renner2014' })).toHaveAttribute(
      'href',
      '/app/references/018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d40',
    );
    expect(within(drawer).getByRole('link', { name: 'TRY-6.0' })).toBeInTheDocument();
    expect(within(drawer).getByText('treerepro-2026-08.csv')).toBeInTheDocument();
    expect(within(drawer).getByText('4821')).toBeInTheDocument();
    expect(within(drawer).getByText('2026-09-01')).toBeInTheDocument();
    expect(within(drawer).getByText('harmonised')).toBeInTheDocument();
    expect(within(drawer).getByText('confirmed')).toBeInTheDocument();
    expect(within(drawer).getByText('No annotations yet')).toBeInTheDocument();
    expect(within(drawer).getByText('No accepted value decisions yet')).toBeInTheDocument();

    // Escape closes only the drawer on top; the panel stays.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Record' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'sexual system' })).toBeInTheDocument();
  });

  it('shows a manual record with its author, note, annotations and accepted history', async () => {
    dataset.fetchRecord.mockResolvedValue(CURATED_RECORD_DETAIL);
    await openPage();
    const panel = await openTraitPanel();
    await userEvent.click(await within(panel).findByRole('button', { name: 'about two' }));
    const drawer = await screen.findByRole('dialog', { name: 'Record' });
    expect(await within(drawer).findByText('Field observation, dry season.')).toBeInTheDocument();
    expect(within(drawer).getByText('Author').nextElementSibling).toHaveTextContent('Ada');
    expect(within(drawer).getByText('Secondary').nextElementSibling).toHaveTextContent('—');
    expect(within(drawer).getByText('Raw value').nextElementSibling).toHaveTextContent('—');
    expect(within(drawer).getByText('dispute')).toBeInTheDocument();
    expect(within(drawer).getByText('Grace')).toBeInTheDocument();
    expect(within(drawer).getByText('Value is not a number.')).toBeInTheDocument();
    expect(within(drawer).getByText('accepted')).toBeInTheDocument();
    expect(within(drawer).getByText('2026-09-04')).toBeInTheDocument();
    expect(within(drawer).queryByText('No annotations yet')).not.toBeInTheDocument();
  });

  it('keeps showing the record after a background refetch fails', async () => {
    const { queryClient } = await openPage();
    const panel = await openTraitPanel();
    await userEvent.click(await within(panel).findByRole('button', { name: 'dioecious' }));
    const drawer = await screen.findByRole('dialog', { name: 'Record' });
    expect(await within(drawer).findByText('Dioecious')).toBeInTheDocument();

    dataset.fetchRecord.mockRejectedValueOnce(new Error('network blip'));
    await act(() => queryClient.refetchQueries({ queryKey: datasetKeys.record(RECORD.id) }));

    expect(within(drawer).getByText('Dioecious')).toBeInTheDocument();
    expect(within(drawer).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('maps RECORD_NOT_FOUND inside the drawer', async () => {
    dataset.fetchRecord.mockRejectedValue(new ApiError(404, 'RECORD_NOT_FOUND', 'x'));
    await openPage();
    const panel = await openTraitPanel();
    await userEvent.click(await within(panel).findByRole('button', { name: 'dioecious' }));
    const drawer = await screen.findByRole('dialog', { name: 'Record' });
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'This record does not exist.',
    );
  });
});

describe('RFC-65 R6 SpeciesPage trait panel follows the live summary', () => {
  // The summary as the page first loads it, with RECORD as the accepted
  // value, and the same summary once the accepted value is cleared.
  const withAccepted: SpeciesTraits = [
    {
      category: { key: 'sexual_system', label: 'Sexual system' },
      traits: [
        {
          ...SEXUAL_SYSTEM_SUMMARY,
          accepted: { recordId: RECORD.id, valueText: 'dioecious', decidedAt: RECORD.createdAt },
        },
      ],
    },
  ];
  const cleared: SpeciesTraits = [
    {
      category: { key: 'sexual_system', label: 'Sexual system' },
      traits: [{ ...SEXUAL_SYSTEM_SUMMARY, accepted: null }],
    },
  ];

  it('drops the accepted badge from the row once Clear refetches the summary', async () => {
    // The real invalidation, so the write reaches the species' summary query
    // the way it does in production.
    const actual =
      await vi.importActual<typeof import('../../api/curation.ts')>('../../api/curation.ts');
    curation.invalidateAfterRecordWrite.mockImplementation(actual.invalidateAfterRecordWrite);
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'accepted.manage'] });
    dataset.fetchSpeciesTraits.mockResolvedValueOnce(withAccepted).mockResolvedValue(cleared);
    dataset.fetchRecords.mockResolvedValue(page([RECORD]));
    curation.fetchAccepted.mockResolvedValue(ACCEPTED_STATE);
    curation.setAccepted.mockResolvedValue(EMPTY_ACCEPTED);
    await openPage();
    const panel = await openTraitPanel();
    const table = await within(panel).findByRole('table');
    expect(within(table).getByText('accepted')).toBeInTheDocument();

    await userEvent.click(await within(panel).findByRole('button', { name: 'Clear' }));
    await userEvent.type(
      within(panel).getByRole('textbox', { name: /why is the accepted value cleared/i }),
      'Sources disagree',
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm clear' }));
    await waitFor(() => expect(curation.setAccepted).toHaveBeenCalled());
    await waitFor(() => expect(dataset.fetchSpeciesTraits).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(panel).queryByText('accepted', { selector: 'span' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'sexual system' })).toBeInTheDocument();
  });

  it('closes the panel when its trait leaves the summary', async () => {
    dataset.fetchSpeciesTraits.mockResolvedValueOnce(withAccepted).mockResolvedValue([]);
    const { queryClient } = await openPage();
    await openTraitPanel();
    await act(() =>
      queryClient.refetchQueries({ queryKey: datasetKeys.speciesTraits(SPECIES.id) }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('RFC-13 R4, R6 SpeciesPage errors', () => {
  it('SPECIES_NOT_FOUND renders the not-found alert and nothing else', async () => {
    dataset.fetchSpecies.mockRejectedValue(new ApiError(404, 'SPECIES_NOT_FOUND', 'x'));
    dataset.fetchSpeciesTraits.mockRejectedValue(new ApiError(404, 'SPECIES_NOT_FOUND', 'x'));
    renderAt(`/app/species/${SPECIES.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('This species does not exist.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Species');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('a rejected id (VALIDATION_FAILED) reads as not found', async () => {
    const rejected = new ApiError(400, 'VALIDATION_FAILED', 'x', [{ path: 'id', message: 'x' }]);
    dataset.fetchSpecies.mockRejectedValue(rejected);
    dataset.fetchSpeciesTraits.mockRejectedValue(rejected);
    renderAt('/app/species/not-a-uuid');
    expect(await screen.findByRole('alert')).toHaveTextContent('This species does not exist.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('a 403 shows the permission sentence once; another failure the generic one', async () => {
    dataset.fetchSpecies.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    dataset.fetchSpeciesTraits.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = renderAt(`/app/species/${SPECIES.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    first.unmount();

    dataset.fetchSpecies.mockResolvedValue(SPECIES);
    dataset.fetchSpeciesTraits.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    await openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.getByText('Fabaceae › Adenanthera')).toBeInTheDocument();
  });

  it('a species 404 renders only the alert, even once traits resolves', async () => {
    dataset.fetchSpecies.mockRejectedValue(new ApiError(404, 'SPECIES_NOT_FOUND', 'x'));
    dataset.fetchSpeciesTraits.mockResolvedValue(SPECIES_TRAITS);
    const withTraits = renderAt(`/app/species/${SPECIES.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('This species does not exist.');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText('No trait records for this species yet.')).not.toBeInTheDocument();
    withTraits.unmount();

    dataset.fetchSpeciesTraits.mockResolvedValue([]);
    renderAt(`/app/species/${SPECIES.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('This species does not exist.');
    expect(screen.queryByText('No trait records for this species yet.')).not.toBeInTheDocument();
  });

  it('a 403 inside the trait panel is shown there', async () => {
    dataset.fetchRecords.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    await openPage();
    const panel = await openTraitPanel();
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
  });
});

describe('RFC-13 R2 SpeciesPage remounts per id', () => {
  it('closes an open trait panel and refetches when navigating to another species', async () => {
    dataset.fetchSpecies.mockImplementation(async (id: string) =>
      id === UNRESOLVED_SPECIES.id ? UNRESOLVED_SPECIES : SPECIES,
    );
    dataset.fetchSpeciesTraits.mockImplementation(async (id: string) =>
      id === UNRESOLVED_SPECIES.id ? [] : SPECIES_TRAITS,
    );
    const { router } = await openPage();
    await openTraitPanel();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await router.navigate({ to: '/app/species/$id', params: { id: UNRESOLVED_SPECIES.id } });

    expect(
      await screen.findByRole('heading', { level: 1, name: /Adansonia digitata/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(dataset.fetchSpecies).toHaveBeenCalledWith(UNRESOLVED_SPECIES.id);
  });
});

describe('RFC-70 R1 Add entries from the species page', () => {
  it('shows the add buttons only with records.create; the header button opens the dialog without a trait, a card button with its trait', async () => {
    const first = await openPage();
    expect(screen.queryByRole('button', { name: ADD_ENTRIES })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add value for/ })).not.toBeInTheDocument();
    // Unmount before remounting with the new permission: both renders show
    // the same species name, so a second `openPage()` without unmounting
    // would let its heading wait resolve against the still-mounted first
    // tree's stale heading instead of the new one.
    first.unmount();
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: ADD_ENTRIES }));
    const dialog = await screen.findByRole('dialog', { name: ADD_ENTRIES });
    expect(
      within(dialog).getByRole('combobox', { name: 'Broad trait category' }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: ADD_ENTRIES })).not.toBeInTheDocument(),
    );
    const card = screen.getByRole('button', { name: /^sexual system/ })
      .parentElement as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /^Add value for/ }));
    const prefilled = await screen.findByRole('dialog', { name: ADD_ENTRIES });
    expect(within(prefilled).getByText('sexual system')).toBeInTheDocument();
    expect(within(prefilled).queryByRole('combobox', { name: 'Trait' })).not.toBeInTheDocument();
  });

  it('RFC-70 R3 opens the first created record in the drawer', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    curation.createRecords.mockResolvedValue({ created: [RECORD_DETAIL], duplicates: [] });
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: ADD_ENTRIES }));
    const dialog = await screen.findByRole('dialog', { name: ADD_ENTRIES });
    await within(dialog).findByRole('option', { name: 'Reproductive system' });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Broad trait category' }),
      'Reproductive system',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Trait' }),
      'sexual system',
    );
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Level' }),
      'dioecious',
    );
    // No DOI: the claim is the contributor's own observation (RFC-80 R5).
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record(s)' }));
    expect(await screen.findByRole('dialog', { name: 'Record' })).toHaveTextContent('dioecious');
    expect(dataset.fetchRecord).toHaveBeenCalledWith(RECORD_DETAIL.id);
  });
});

describe('RFC-60 R9 SpeciesPage taxa editing', () => {
  it('hides "Edit species" and "Add name" from a reader', async () => {
    renderAt(`/app/species/${SPECIES.id}`);
    await screen.findByText('Adenanthera pavonina');
    expect(screen.queryByRole('button', { name: 'Edit species' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add name' })).not.toBeInTheDocument();
  });

  it('edits the species and re-renders the header from the refetched detail', async () => {
    auth.fetchMe.mockResolvedValue(CURATOR_TAXA);
    dataset.fetchSpecies
      .mockResolvedValueOnce(SPECIES)
      .mockResolvedValue({ ...SPECIES, nameSource: 'original' });
    dataset.fetchFamilies.mockResolvedValue(FAMILIES);
    catalog.updateSpecies.mockResolvedValue({ ...SPECIES, nameSource: 'original' });
    renderAt(`/app/species/${SPECIES.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit species' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit species' });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /name source/i }),
      'original',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(catalog.updateSpecies).toHaveBeenCalledWith(SPECIES.id, { nameSource: 'original' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(dataset.fetchSpecies).toHaveBeenCalledTimes(2));
  });

  it('adds an alternative name and shows it in the header', async () => {
    auth.fetchMe.mockResolvedValue(CURATOR_TAXA);
    const withName = {
      ...SPECIES,
      names: [
        ...SPECIES.names,
        { name: 'Adenanthera polita', source: 'gbif' as const, gbifUsageKey: null },
      ],
    };
    dataset.fetchSpecies.mockResolvedValueOnce(SPECIES).mockResolvedValue(withName);
    catalog.addSpeciesName.mockResolvedValue(withName);
    renderAt(`/app/species/${SPECIES.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Add name' }));
    const dialog = screen.getByRole('dialog', { name: 'Add alternative name' });
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /^name/i }),
      'Adenanthera polita',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add name' }));
    expect(await screen.findByText(/Adenanthera polita/)).toBeInTheDocument();
  });

  it('RFC-67 R8 shows In your plots for contributor and Plots for plots.manage', async () => {
    auth.fetchMe.mockResolvedValue(READER);
    const withPlots = {
      ...SPECIES,
      plots: [
        { id: 'p-1', code: 'A', name: 'Plot A' },
        { id: 'p-2', code: 'B', name: 'Plot B' },
      ],
    };
    dataset.fetchSpecies.mockResolvedValue(withPlots);
    renderAt(`/app/species/${SPECIES.id}`);
    expect(await screen.findByText('In your plots: Plot A, Plot B')).toBeInTheDocument();

    auth.fetchMe.mockResolvedValue(ADMIN_ME);
    renderAt(`/app/species/${SPECIES.id}`);
    expect(await screen.findByText('Plots: Plot A, Plot B')).toBeInTheDocument();
  });
});
