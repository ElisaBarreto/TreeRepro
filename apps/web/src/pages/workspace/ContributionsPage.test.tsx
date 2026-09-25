import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_USER } from '../../test/admin-fixtures.ts';
import {
  APPROVED_PROPOSAL,
  CONTESTING_CONTRIBUTION,
  CONTRIBUTION_ANNOTATION,
  CONTRIBUTION_RECORD,
  CONTRIBUTION_SUMMARY,
  CURATED_RECORD_DETAIL,
  DICTIONARY,
  GENERATED_CONTRIBUTION_ANNOTATION,
  PROPOSAL,
  REJECTED_PROPOSAL,
  SPECIES,
} from '../../test/dataset-fixtures.ts';
import { ME, USER } from '../../test/fixtures.ts';
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
const contributions = vi.hoisted(() => ({
  fetchMyContributions: vi.fn(),
  fetchMySummary: vi.fn(),
  fetchUserContributions: vi.fn(),
  fetchUserSummary: vi.fn(),
}));
const dataset = vi.hoisted(() => ({
  fetchDictionary: vi.fn(),
  searchSpecies: vi.fn(),
  fetchRecord: vi.fn(),
}));
const admin = vi.hoisted(() => ({ fetchUser: vi.fn() }));
const proposals = vi.hoisted(() => ({ fetchMyProposals: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/contributions.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/contributions.ts')>()),
  ...contributions,
}));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/admin.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/admin.ts')>()),
  ...admin,
}));
vi.mock('../../api/proposals.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/proposals.ts')>()),
  ...proposals,
}));

const CONTRIBUTOR: MeResponse = { ...ME, permissions: ['dataset.read'] };
const MANAGER: MeResponse = { ...ME, permissions: ['dataset.read', 'contributions.read'] };
const MANAGER_WITH_USERS: MeResponse = {
  ...ME,
  permissions: [...MANAGER.permissions, 'users.read'],
};
const OTHER_ID = USER.id;
const page = <T,>(data: T[], nextCursor: string | null = null) => ({ data, meta: { nextCursor } });

beforeEach(() => {
  for (const mock of [
    ...Object.values(auth),
    ...Object.values(contributions),
    ...Object.values(dataset),
    ...Object.values(admin),
    ...Object.values(proposals),
  ]) {
    mock.mockReset();
  }
  auth.fetchMe.mockResolvedValue(CONTRIBUTOR);
  proposals.fetchMyProposals.mockResolvedValue(page([PROPOSAL]));
  contributions.fetchMyContributions.mockResolvedValue(page([CONTRIBUTION_RECORD]));
  contributions.fetchMySummary.mockResolvedValue(CONTRIBUTION_SUMMARY);
  contributions.fetchUserContributions.mockResolvedValue(page([CONTRIBUTION_RECORD]));
  contributions.fetchUserSummary.mockResolvedValue(CONTRIBUTION_SUMMARY);
  dataset.fetchDictionary.mockResolvedValue(DICTIONARY);
  dataset.searchSpecies.mockResolvedValue(page([SPECIES]));
  dataset.fetchRecord.mockResolvedValue(CURATED_RECORD_DETAIL);
});

describe('RFC-71 R1, R2, R4 the contributions page', () => {
  it('opens on the records tab and shows the summary as tiles', async () => {
    const { router } = renderAt('/app/contributions');
    expect(await screen.findByRole('heading', { name: 'My contributions' })).toBeInTheDocument();
    expect(contributions.fetchMyContributions).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'records', cursor: undefined, limit: 50 }),
    );
    expect(contributions.fetchMySummary).toHaveBeenCalledTimes(1);
    expect(contributions.fetchUserContributions).not.toHaveBeenCalled();
    const tiles = await screen.findByRole('list', { name: 'Summary' });
    const labels = within(tiles)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(labels).toEqual([
      'Records12',
      'Contests2',
      'Complements3',
      'Validations7',
      'Disputes1',
      'Withdrawn1',
    ]);
    expect(router.state.location.search).toEqual({});
  });

  it('RFC-71 R4 counts every row in the tiles although the list omits what the viewer may not see', async () => {
    renderAt('/app/contributions');
    const tiles = await screen.findByRole('list', { name: 'Summary' });
    // Twelve records counted, one row listed: the summary counts rows on
    // species the viewer may no longer see, the list does not.
    expect(within(tiles).getByText('12')).toBeInTheDocument();
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(2);
  });

  it('marks each record with its standing and opens the drawer on a row', async () => {
    contributions.fetchMyContributions.mockResolvedValue(
      page([CONTRIBUTION_RECORD, CONTESTING_CONTRIBUTION]),
    );
    renderAt('/app/contributions');
    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toContain('Status');
    const [, answered, contesting] = within(table).getAllByRole('row') as HTMLElement[];
    expect(within(answered as HTMLElement).getByText('disputed')).toBeInTheDocument();
    expect(within(answered as HTMLElement).queryByText('contest')).not.toBeInTheDocument();
    expect(within(contesting as HTMLElement).getByText('contest')).toBeInTheDocument();
    expect(within(table).queryByText('accepted')).not.toBeInTheDocument();
    // `responseCount` of RFC-71 R2: one record answers this one.
    expect(within(answered as HTMLElement).getByText('1 answer')).toBeInTheDocument();
    expect(within(contesting as HTMLElement).queryByText(/answer/)).not.toBeInTheDocument();

    await userEvent.click(
      within(answered as HTMLElement).getByRole('button', { name: 'about two' }),
    );
    await waitFor(() => expect(dataset.fetchRecord).toHaveBeenCalledWith(CONTRIBUTION_RECORD.id));
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    contributions.fetchMyContributions.mockResolvedValue(page([]));
    renderAt('/app/contributions');
    expect(await screen.findByText('No record of yours matches.')).toBeInTheDocument();
  });
});

describe('RFC-71 R3 the annotations tab', () => {
  it('is reached by a tab that writes ?kind= and asks the API for annotations', async () => {
    const { router } = renderAt('/app/contributions');
    await screen.findByRole('table');
    expect(screen.getByRole('link', { name: 'Records' })).toHaveAttribute('aria-current', 'page');
    contributions.fetchMyContributions.mockResolvedValue(
      page([CONTRIBUTION_ANNOTATION, GENERATED_CONTRIBUTION_ANNOTATION]),
    );
    await userEvent.click(screen.getByRole('link', { name: 'Annotations' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ kind: 'annotations' }));
    await waitFor(() =>
      expect(contributions.fetchMyContributions).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'annotations' }),
      ),
    );
    expect(await screen.findByText('automatic')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Annotations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens on the annotations tab when the URL says so', async () => {
    contributions.fetchMyContributions.mockResolvedValue(page([CONTRIBUTION_ANNOTATION]));
    renderAt('/app/contributions?kind=annotations');
    expect(
      await screen.findByRole('button', { name: 'Adenanthera pavonina › sexual system' }),
    ).toBeInTheDocument();
    expect(contributions.fetchMyContributions).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'annotations' }),
    );
  });

  it('says so when no annotation matches', async () => {
    contributions.fetchMyContributions.mockResolvedValue(page([]));
    renderAt('/app/contributions?kind=annotations');
    expect(await screen.findByText('No annotation of yours matches.')).toBeInTheDocument();
  });
});

describe('RFC-71 R1 the filters are URL params', () => {
  it('writes a chosen filter into the URL and sends it to the API', async () => {
    const { router } = renderAt('/app/contributions');
    await screen.findByRole('table');
    await userEvent.selectOptions(await screen.findByLabelText('Review'), 'disputed');
    await waitFor(() => expect(router.state.location.search).toEqual({ review: 'disputed' }));
    await waitFor(() =>
      expect(contributions.fetchMyContributions).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'records', review: 'disputed' }),
      ),
    );
  });

  it('seeds the controls and the request from a URL that already carries them', async () => {
    const traitId = DICTIONARY[1]?.traits[0]?.id as string;
    renderAt(
      `/app/contributions?kind=records&traitId=${traitId}&speciesId=${SPECIES.id}&review=confirmed&intent=contest&from=2026-09-01&to=2026-09-30`,
    );
    await screen.findByRole('table');
    expect(contributions.fetchMyContributions).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'records',
        traitId,
        speciesId: SPECIES.id,
        review: 'confirmed',
        intent: 'contest',
        from: '2026-09-01',
        to: '2026-09-30',
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Trait')).toHaveValue(traitId));
    expect(screen.getByLabelText('Review')).toHaveValue('confirmed');
    expect(screen.getByLabelText('Intent')).toHaveValue('contest');
    expect(screen.getByLabelText('Record added from')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Record added to')).toHaveValue('2026-09-30');
  });

  it('keeps the filters when the tab changes', async () => {
    const { router } = renderAt('/app/contributions?review=disputed');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('link', { name: 'Annotations' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ kind: 'annotations', review: 'disputed' }),
    );
  });

  it('ignores a filter the URL spells wrongly', async () => {
    renderAt('/app/contributions?review=nonsense&traitId=not-a-uuid');
    await screen.findByRole('table');
    expect(contributions.fetchMyContributions).toHaveBeenCalledWith(
      expect.objectContaining({ review: undefined, traitId: undefined }),
    );
  });
});

describe("RFC-71 R5 another user's contributions", () => {
  it('titles the page with the name from the user route and calls the user routes', async () => {
    auth.fetchMe.mockResolvedValue(MANAGER_WITH_USERS);
    admin.fetchUser.mockResolvedValue({ ...ADMIN_USER, id: OTHER_ID, name: 'Grace Hopper' });
    renderAt(`/app/contributions?userId=${OTHER_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'Contributions of Grace Hopper' }),
    ).toBeInTheDocument();
    expect(admin.fetchUser).toHaveBeenCalledWith(OTHER_ID);
    expect(contributions.fetchUserContributions).toHaveBeenCalledWith(
      OTHER_ID,
      expect.objectContaining({ kind: 'records' }),
    );
    expect(contributions.fetchUserSummary).toHaveBeenCalledWith(OTHER_ID);
    expect(contributions.fetchMyContributions).not.toHaveBeenCalled();
    expect(contributions.fetchMySummary).not.toHaveBeenCalled();
  });

  it("falls back to the first record's author without users.read", async () => {
    auth.fetchMe.mockResolvedValue(MANAGER);
    renderAt(`/app/contributions?userId=${OTHER_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'Contributions of Ada' }),
    ).toBeInTheDocument();
    expect(admin.fetchUser).not.toHaveBeenCalled();
  });

  it('falls back to the id when no row names the author', async () => {
    auth.fetchMe.mockResolvedValue(MANAGER);
    contributions.fetchUserContributions.mockResolvedValue(page([]));
    renderAt(`/app/contributions?userId=${OTHER_ID}`);
    expect(
      await screen.findByRole('heading', { name: `Contributions of ${OTHER_ID}` }),
    ).toBeInTheDocument();
  });

  it('RFC-13 R3 refuses the user view without contributions.read', async () => {
    auth.fetchMe.mockResolvedValue(CONTRIBUTOR);
    renderAt(`/app/contributions?userId=${OTHER_ID}`);
    expect(
      await screen.findByText('You do not have permission to open this area.'),
    ).toBeInTheDocument();
    expect(contributions.fetchUserContributions).not.toHaveBeenCalled();
    expect(contributions.fetchMyContributions).not.toHaveBeenCalled();
  });
});

describe('RFC-13 R3 without dataset.read', () => {
  it('shows no page and calls nothing', async () => {
    auth.fetchMe.mockResolvedValue(ME);
    renderAt('/app/contributions');
    expect(
      await screen.findByText('You do not have permission to open this area.'),
    ).toBeInTheDocument();
    expect(contributions.fetchMyContributions).not.toHaveBeenCalled();
    expect(contributions.fetchMySummary).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'My contributions' })).not.toBeInTheDocument();
  });
});

describe('RFC-75 R5 the Proposals tab', () => {
  const PROPOSER: MeResponse = { ...ME, permissions: ['dataset.read', 'taxa.propose'] };

  it('appears only with taxa.propose', async () => {
    const { unmount } = renderAt('/app/contributions');
    // The Records tab is on screen, so the tab strip has rendered and this
    // negative assertion is about the entry, not about an empty page.
    expect(await screen.findByRole('link', { name: 'Records' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Proposals' })).not.toBeInTheDocument();
    unmount();

    auth.fetchMe.mockResolvedValue(PROPOSER);
    renderAt('/app/contributions');
    expect(await screen.findByRole('link', { name: 'Proposals' })).toBeInTheDocument();
  });

  it('lists the viewer\u2019s proposals with their status, decision note and species link', async () => {
    auth.fetchMe.mockResolvedValue(PROPOSER);
    proposals.fetchMyProposals.mockResolvedValue(
      page([PROPOSAL, APPROVED_PROPOSAL, REJECTED_PROPOSAL]),
    );
    renderAt('/app/contributions?kind=proposals');
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('open')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('approved')).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByRole('link', { name: SPECIES.canonicalName }),
    ).toHaveAttribute('href', `/app/species/${SPECIES.id}`);
    const rejected = rows[2] as HTMLElement;
    expect(within(rejected).getByText('rejected')).toBeInTheDocument();
    expect(rejected).toHaveTextContent('No such taxon; check the spelling.');
    expect(contributions.fetchMyContributions).not.toHaveBeenCalled();
  });

  it('says so when the viewer has proposed nothing', async () => {
    auth.fetchMe.mockResolvedValue(PROPOSER);
    proposals.fetchMyProposals.mockResolvedValue(page([]));
    renderAt('/app/contributions?kind=proposals');
    expect(await screen.findByText('You have not proposed a species yet.')).toBeInTheDocument();
  });

  it('RFC-71 R5 another user\u2019s contributions have no Proposals tab: there is no route for it', async () => {
    auth.fetchMe.mockResolvedValue({
      ...MANAGER_WITH_USERS,
      permissions: [...MANAGER_WITH_USERS.permissions, 'taxa.propose'],
    });
    admin.fetchUser.mockResolvedValue(ADMIN_USER);
    renderAt(`/app/contributions?userId=${OTHER_ID}`);
    expect(await screen.findByRole('link', { name: 'Records' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Proposals' })).not.toBeInTheDocument();
    expect(proposals.fetchMyProposals).not.toHaveBeenCalled();
  });
});
