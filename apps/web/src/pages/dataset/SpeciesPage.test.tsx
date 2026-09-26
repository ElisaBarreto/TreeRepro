import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse, RecordItem, SpeciesTraits } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { datasetKeys } from '../../api/dataset.ts';
import {
  CURATED_RECORD_DETAIL,
  DICTIONARY,
  DICTIONARY_SEXUAL_SYSTEM,
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
  SPECIES_TRAITS_WITH_MISSING,
  SPECIES_WITH_NAME_GROUPS,
  SPECIES_WITH_SYNONYM_ONLY,
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
// The trait cards call `useMaps()` themselves (RFC-76 R8); mocked directly,
// the same way `MapsPage.test.tsx` does, so this file never has to reason
// about the maps manifest to keep its species-page assertions passing.
const maps = vi.hoisted(() => ({ useMaps: vi.fn() }));
// `invalidateAfterRecordWrite` keeps the real signature so one test can
// swap the real implementation in.
const curation = vi.hoisted(() => ({
  createRecords: vi.fn(),
  annotateRecord: vi.fn(),
  validateLevel: vi.fn(),
  resolveDoi: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(
    async (_queryClient: QueryClient, _speciesId?: string): Promise<void> => undefined,
  ),
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
vi.mock('../../api/maps.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/maps.ts')>()),
  ...maps,
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
  dataset.fetchDictionary.mockReset();
  dataset.searchReferences.mockReset();
  dataset.fetchFamilies.mockReset().mockResolvedValue(FAMILIES);
  dataset.fetchGenera.mockReset().mockResolvedValue({ data: GENERA, meta: { nextCursor: null } });
  curation.createRecords.mockReset();
  curation.annotateRecord.mockReset().mockResolvedValue(RECORD_DETAIL);
  curation.validateLevel.mockReset().mockResolvedValue({ validated: [] });
  curation.resolveDoi.mockReset();
  curation.invalidateAfterRecordWrite.mockReset().mockResolvedValue(undefined);
  catalog.updateSpecies.mockReset();
  catalog.addSpeciesName.mockReset();
  maps.useMaps.mockReset();
  maps.useMaps.mockReturnValue({
    data: [],
    isPending: false,
    isSuccess: true,
    isError: false,
    error: null,
  });
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
    expect(dataset.fetchSpeciesTraits).toHaveBeenCalledWith(SPECIES.id, { includeMissing: false });
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

describe('RFC-60 R4, R7 SpeciesPage name groups', () => {
  it('groups gbif names as "Also known as", synonyms as "Synonyms" and common names with a language chip', async () => {
    dataset.fetchSpecies.mockResolvedValue(SPECIES_WITH_NAME_GROUPS);
    await openPage(SPECIES_WITH_NAME_GROUPS);
    expect(screen.getByText(/Also known as/)).toBeInTheDocument();
    expect(screen.getByText('Adenanthera gersenii')).toBeInTheDocument();
    expect(screen.getByText(/Synonyms/)).toBeInTheDocument();
    expect(screen.getByText('Adenanthera bicolor')).toBeInTheDocument();
    expect(screen.getByText(/Common names/)).toBeInTheDocument();
    const commonName = screen.getByText('Tento-carolina');
    expect(commonName.tagName).toBe('EM');
    expect(screen.getByText('pt')).toBeInTheDocument();
  });

  it('hides a name group with no names of that type', async () => {
    dataset.fetchSpecies.mockResolvedValue(SPECIES_WITH_SYNONYM_ONLY);
    await openPage(SPECIES_WITH_SYNONYM_ONLY);
    expect(screen.getByText(/Synonyms/)).toBeInTheDocument();
    expect(screen.getByText('Adenanthera bicolor')).toBeInTheDocument();
    expect(screen.queryByText(/Also known as/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Common names/)).not.toBeInTheDocument();
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
        sort: 'added',
        order: 'desc',
        cursor: undefined,
        limit: 50,
      }),
    );
    expect(panel).toHaveTextContent('8 records');
    const rows = within(await within(panel).findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: 'dioecious' })).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Renner2014' })).toBeVisible();
    expect(within(rows[1] as HTMLElement).getAllByRole('link', { name: 'TRY-6.0' })).toHaveLength(
      2,
    );
    expect(rows[1]).toHaveTextContent('import');
    expect(within(rows[1] as HTMLElement).getByText('harmonised')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('2026-09-01');
    expect(within(rows[2] as HTMLElement).getByRole('button', { name: 'about two' })).toBeVisible();
    expect(within(rows[2] as HTMLElement).getByText('not a number')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Contested')).toBeInTheDocument();
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
    expect(within(drawer).getByText('No annotations yet')).toBeInTheDocument();

    // Escape closes only the drawer on top; the panel stays.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Record' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'sexual system' })).toBeInTheDocument();
  });

  it('shows a manual record with its author, note and annotations', async () => {
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
    expect(within(drawer).queryByText('Accepted history')).not.toBeInTheDocument();
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

describe('RFC-74 R5 ?record= opens the drawer on mount', () => {
  it('opens the record drawer on mount from ?record=<uuid>, the digest e-mail deep link', async () => {
    renderAt(`/app/species/${SPECIES.id}?record=${RECORD.id}`);
    const drawer = await screen.findByRole('dialog', { name: 'Record' });
    expect(dataset.fetchRecord).toHaveBeenCalledWith(RECORD.id);
    expect(await within(drawer).findByText('Dioecious')).toBeInTheDocument();
  });

  it('opens nothing when the record param is absent', async () => {
    await openPage();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(dataset.fetchRecord).not.toHaveBeenCalled();
  });

  it('opens nothing for a malformed record param', async () => {
    renderAt(`/app/species/${SPECIES.id}?record=not-a-uuid`);
    await screen.findByRole('heading', { level: 1, name: /Adenanthera pavonina/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(dataset.fetchRecord).not.toHaveBeenCalled();
  });

  it('RFC-70 R7 the missing toggle keeps ?record= in the URL, so the deep link survives it', async () => {
    // Nothing visibly breaks when it does not — the drawer is seeded state and
    // stays open — but the link an operator copies out of the address bar
    // stops opening the record after a single toggle.
    dataset.fetchSpeciesTraits.mockResolvedValue(SPECIES_TRAITS_WITH_MISSING);
    const { router } = renderAt(`/app/species/${SPECIES.id}?record=${RECORD.id}`);
    const drawer = await screen.findByRole('dialog', { name: 'Record' });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Record' })).not.toBeInTheDocument(),
    );

    const box = screen.getByRole('checkbox', { name: 'Show traits with no data' });
    await userEvent.click(box);
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ missing: true, record: RECORD.id }),
    );

    // And back off: the toggle owns `missing` alone in both directions.
    await userEvent.click(box);
    await waitFor(() => expect(router.state.location.search).toEqual({ record: RECORD.id }));
  });
});

describe('RFC-63 R10 SpeciesPage trait panel follows the live summary', () => {
  const summary: SpeciesTraits = [
    { category: { key: 'sexual_system', label: 'Sexual system' }, traits: [SEXUAL_SYSTEM_SUMMARY] },
  ];
  it('closes the panel when its trait leaves the summary', async () => {
    dataset.fetchSpeciesTraits.mockResolvedValueOnce(summary).mockResolvedValue([]);
    const { queryClient } = await openPage();
    await openTraitPanel();
    await act(() =>
      queryClient.refetchQueries({ queryKey: datasetKeys.speciesTraits(SPECIES.id, false) }),
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
    await userEvent.click(screen.getByRole('button', { name: 'Add value for sexual system' }));
    // The title names the fixed trait instead of the header button's generic
    // constant: "another trait" would contradict a trait already chosen.
    const prefilled = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    expect(within(prefilled).getByText('sexual system')).toBeInTheDocument();
    expect(within(prefilled).queryByRole('combobox', { name: 'Trait' })).not.toBeInTheDocument();
  });

  it('RFC-70 R3 opens the first created record in the drawer', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    // The dialog reads the species' records for the trait: none, so no intent step.
    dataset.fetchRecords.mockResolvedValue(page([]));
    curation.createRecords.mockResolvedValue({
      created: [RECORD_DETAIL],
      validated: [],
      duplicates: [],
    });
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
    const dioecious = await within(dialog).findByRole('checkbox', { name: 'dioecious' });
    await waitFor(() => expect(dioecious).toBeEnabled());
    await userEvent.click(dioecious);
    // No DOI: the claim is the contributor's own observation (RFC-80 R5).
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add record(s)' }));
    expect(await screen.findByRole('dialog', { name: 'Record' })).toHaveTextContent('dioecious');
    expect(dataset.fetchRecord).toHaveBeenCalledWith(RECORD_DETAIL.id);
  });
});

// SPECIES_TRAITS_WITH_MISSING adds two zero-count traits, one card each.
const MISSING_TRAITS = 2;

describe('RFC-70 R7 species page missing toggle', () => {
  it('the checkbox is unchecked by default and the query asks for no missing traits', async () => {
    await openPage();
    expect(screen.getByRole('checkbox', { name: 'Show traits with no data' })).not.toBeChecked();
    expect(dataset.fetchSpeciesTraits).toHaveBeenCalledWith(SPECIES.id, { includeMissing: false });
  });

  it('?missing=true checks the box and asks fetchSpeciesTraits for includeMissing', async () => {
    dataset.fetchSpeciesTraits.mockResolvedValue(SPECIES_TRAITS_WITH_MISSING);
    renderAt(`/app/species/${SPECIES.id}?missing=true`);
    await screen.findByText('Adenanthera pavonina');
    expect(screen.getByRole('checkbox', { name: 'Show traits with no data' })).toBeChecked();
    expect(dataset.fetchSpeciesTraits).toHaveBeenCalledWith(SPECIES.id, { includeMissing: true });
    // The zero-count traits come from walking DICTIONARY, so their sections
    // are DICTIONARY's own categories, not the ones SPECIES_TRAITS uses for
    // traits that already have records.
    const sections = screen.getAllByRole('heading', { level: 2 });
    expect(sections.map((h) => h.textContent)).toEqual(['Reproductive system', 'Seed']);
  });

  it('checking the box navigates to ?missing=true and refetches with includeMissing', async () => {
    const { router } = await openPage();
    dataset.fetchSpeciesTraits.mockResolvedValue(SPECIES_TRAITS_WITH_MISSING);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show traits with no data' }));
    await waitFor(() =>
      expect(dataset.fetchSpeciesTraits).toHaveBeenCalledWith(SPECIES.id, {
        includeMissing: true,
      }),
    );
    expect(screen.getByRole('checkbox', { name: 'Show traits with no data' })).toBeChecked();
    expect(router.state.location.search).toEqual({ missing: true });
  });

  it('a zero-count trait renders as EmptyTraitCard with "No records yet"; with records.create, "Add the first entry" opens the dialog with the trait fixed', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    dataset.fetchSpeciesTraits.mockResolvedValue(SPECIES_TRAITS_WITH_MISSING);
    renderAt(`/app/species/${SPECIES.id}?missing=true`);
    await screen.findByText('Adenanthera pavonina');
    expect(screen.getAllByText('No records yet')).toHaveLength(MISSING_TRAITS);
    const [firstAdd] = screen.getAllByRole('button', { name: 'Add the first entry' });
    await userEvent.click(firstAdd as HTMLElement);
    const dialog = await screen.findByRole('dialog', {
      name: 'Add entries for self compatibility',
    });
    expect(within(dialog).queryByRole('combobox', { name: 'Trait' })).not.toBeInTheDocument();
  });

  it('hides "Add the first entry" without records.create', async () => {
    dataset.fetchSpeciesTraits.mockResolvedValue(SPECIES_TRAITS_WITH_MISSING);
    renderAt(`/app/species/${SPECIES.id}?missing=true`);
    await screen.findByText('Adenanthera pavonina');
    expect(screen.getAllByText('No records yet')).toHaveLength(MISSING_TRAITS);
    expect(screen.queryByRole('button', { name: 'Add the first entry' })).not.toBeInTheDocument();
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
        {
          name: 'Adenanthera polita',
          nameType: 'gbif' as const,
          language: null,
          source: 'gbif',
          gbifUsageKey: null,
        },
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

describe('RFC-13 R3 SpeciesPage breadcrumb', () => {
  it('registers the canonical name, in italics, as the last crumb of Data › Species', async () => {
    await openPage();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const last = within(trail).getByText(SPECIES.canonicalName);
    expect(last.tagName).toBe('EM');
    expect(last.closest('[aria-current="page"]')).not.toBeNull();
    expect(within(trail).getByRole('link', { name: 'Species' })).toHaveAttribute(
      'href',
      '/app/species',
    );
    expect(trail).toHaveTextContent('Data');
  });

  it('registers nothing while the species is still loading', async () => {
    dataset.fetchSpecies.mockReturnValue(new Promise(() => {}));
    renderAt(`/app/species/${SPECIES.id}`);
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('Species')).toHaveAttribute('aria-current', 'page');
  });
});

const MASS: RecordItem = {
  ...PENDING_RECORD,
  recordCode: 'TR_7',
  level: null,
  quantitative: { single: 1.5 },
};
const DIOECIOUS_LEVEL = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20';
const CONTEST_LABEL = 'Contest — The existing value is wrong; mine should replace it.';
const COMPLEMENT_LABEL =
  'Complement — The existing value is also correct; I am adding another observation.';

// A summary on the dictionary's ids, so the entry dialog opened from a level
// finds the trait's levels: hermaphrodite and dioecious, both with records.
const DICT_HERMAPHRODITE = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11';
const DICT_DIOECIOUS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12';
const DICTIONARY_SPECIES_TRAITS: SpeciesTraits = [
  {
    category: { key: 'reproductive_system', label: 'Reproductive system' },
    traits: [
      {
        ...SEXUAL_SYSTEM_SUMMARY,
        trait: DICTIONARY_SEXUAL_SYSTEM,
        recordCount: 2,
        levels: [
          { levelId: DICT_HERMAPHRODITE, key: 'hermaphrodite' },
          { levelId: DICT_DIOECIOUS, key: 'dioecious' },
        ].map((level) => ({ ...level, count: 1, validationCount: 0, contested: false })),
      },
    ],
  },
];
const LEVEL_RECORDS: RecordItem[] = [
  {
    ...RECORD,
    trait: DICTIONARY_SEXUAL_SYSTEM,
    level: { id: DICT_HERMAPHRODITE, key: 'hermaphrodite' },
    valueText: 'hermaphrodite',
  },
  {
    ...RECORD,
    id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e91',
    recordCode: 'EB_2',
    trait: DICTIONARY_SEXUAL_SYSTEM,
    level: { id: DICT_DIOECIOUS, key: 'dioecious' },
  },
];

describe('RFC-70 R4, R9 SpeciesPage legend and record decisions', () => {
  it('opens with the legend of the three decisions, each word with its icon', async () => {
    await openPage();
    const items = within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Validate',
      'Contest',
      'Complement',
    ]);
    for (const item of items) {
      expect(item.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    }
  });

  it('shows no level decisions to a reader', async () => {
    await openPage();
    expect(
      screen.queryByRole('button', { name: 'Validate dioecious for sexual system' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Contest dioecious for sexual system' }),
    ).not.toBeInTheDocument();
  });

  it('validates every record of a level from its card (R-6)', async () => {
    auth.fetchMe.mockResolvedValue({
      ...READER,
      permissions: ['dataset.read', 'records.annotate'],
    });
    await openPage();
    await userEvent.click(
      screen.getByRole('button', { name: 'Validate dioecious for sexual system' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Validate dioecious' });
    expect(
      within(dialog).getByText('Do you confirm that this record is correct?'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect(curation.validateLevel).toHaveBeenCalledWith(
        SPECIES.id,
        SEXUAL_SYSTEM.id,
        DIOECIOUS_LEVEL,
        {},
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Validate dioecious' })).not.toBeInTheDocument(),
    );
  });

  it('contests a level from its card: Contest chosen, that level unchecked, the other checked (amendment 6)', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    dataset.fetchSpeciesTraits.mockResolvedValue(DICTIONARY_SPECIES_TRAITS);
    dataset.fetchRecords.mockResolvedValue(page(LEVEL_RECORDS));
    await openPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Contest dioecious for sexual system' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    expect(await within(dialog).findByRole('radio', { name: CONTEST_LABEL })).toBeChecked();
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: 'hermaphrodite' })).toBeChecked(),
    );
    expect(within(dialog).getByRole('checkbox', { name: 'dioecious' })).not.toBeChecked();
    expect(
      within(dialog).queryByRole('combobox', { name: 'Responding to' }),
    ).not.toBeInTheDocument();
  });

  it('complements a level from its card without choosing the intent (ruling 10)', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    dataset.fetchSpeciesTraits.mockResolvedValue(DICTIONARY_SPECIES_TRAITS);
    dataset.fetchRecords.mockResolvedValue(page(LEVEL_RECORDS));
    await openPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Complement dioecious for sexual system' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add entries for sexual system' });
    const complement = await within(dialog).findByRole('radio', { name: COMPLEMENT_LABEL });
    expect(complement).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: CONTEST_LABEL })).not.toBeChecked();
    await userEvent.click(complement);
    expect(within(dialog).getByRole('combobox', { name: 'Responding to' })).toHaveValue(
      DICT_DIOECIOUS,
    );
  });

  it('validates one record from a quantitative trait’s panel', async () => {
    auth.fetchMe.mockResolvedValue({
      ...READER,
      permissions: ['dataset.read', 'records.annotate'],
    });
    // Someone else's record: the viewer's own carries no Validate (spec R-6).
    const theirs = {
      ...MASS,
      createdBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e99', name: 'Grace' },
    };
    dataset.fetchRecords.mockResolvedValue(page([theirs]));
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: /^seed mass/ }));
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Validate TR_7' }));
    const dialog = await screen.findByRole('dialog', { name: 'Validate TR_7' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect(curation.annotateRecord).toHaveBeenCalledWith(theirs.id, { kind: 'confirm' }),
    );
  });

  it('hides Validate on the viewer’s own record in a quantitative trait’s panel (spec R-6)', async () => {
    auth.fetchMe.mockResolvedValue({
      ...READER,
      permissions: ['dataset.read', 'records.annotate'],
    });
    dataset.fetchRecords.mockResolvedValue(page([MASS]));
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: /^seed mass/ }));
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    await within(panel).findByRole('columnheader', { name: 'Added' });
    expect(within(panel).queryByRole('button', { name: 'Validate TR_7' })).not.toBeInTheDocument();
  });

  it('contests one record from a quantitative trait’s panel, that record responded to', async () => {
    auth.fetchMe.mockResolvedValue({ ...READER, permissions: ['dataset.read', 'records.create'] });
    dataset.fetchRecords.mockResolvedValue(page([MASS]));
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: /^seed mass/ }));
    const panel = await screen.findByRole('dialog', { name: 'seed mass' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Contest TR_7' }));
    const dialog = await screen.findByRole('dialog', { name: /^Add entries for seed mass/ });
    expect(await within(dialog).findByRole('radio', { name: CONTEST_LABEL })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Responding to' })).toHaveValue(MASS.id);
  });
});
