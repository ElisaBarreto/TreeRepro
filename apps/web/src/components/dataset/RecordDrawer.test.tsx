import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeResponse } from '@treerepro/contracts';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME_QUERY_KEY } from '../../lib/session.ts';
import {
  CONTEST_RECORD_DETAIL,
  GRACE_PERSONAL_OBSERVATION_REFERENCE,
  RECORD,
  RECORD_DETAIL,
  RESPONDED_RECORD_DETAIL,
} from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { RecordDrawer } from './RecordDrawer.tsx';

const dataset = vi.hoisted(() => ({ fetchRecord: vi.fn() }));
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
const curation = vi.hoisted(() => ({
  annotateRecord: vi.fn(),
  invalidateAfterRecordWrite: vi.fn(async () => undefined),
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));

beforeEach(() => dataset.fetchRecord.mockReset());

// The drawer's source links are router `Link`s and `RecordActions` reads the
// session, so this mounts both a router and a query client seeded with `me` —
// `renderWithProviders` alone has no router context for the `Link`s to use.
function renderDrawer(ui: ReactElement, me: MeResponse) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(ME_QUERY_KEY, me);
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('RFC-65 R3 RecordDrawer actions section', () => {
  it('has no Actions heading for a viewer without a curation permission, and one with records.annotate', async () => {
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    const viewer = renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    await screen.findByText('Dioecious');
    expect(screen.queryByRole('heading', { name: 'Actions' })).not.toBeInTheDocument();
    viewer.unmount();

    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read', 'records.annotate'],
    });
    await screen.findByText('Dioecious');
    const heading = screen.getByRole('heading', { name: 'Actions' });
    expect(heading.parentElement).toContainElement(
      screen.getByRole('button', { name: 'Validate' }),
    );
  });
});

describe('RFC-65 R7 RecordDrawer harmonisation section', () => {
  it('links a record to the pending record it harmonises and to the records that harmonise it', async () => {
    dataset.fetchRecord.mockResolvedValue({
      ...RECORD_DETAIL,
      supersedes: { id: 'pending-000001' },
      supersededBy: [{ id: 'harmonised-000002' }, { id: 'harmonised-000003' }],
    });
    const onOpenRecord = vi.fn();
    renderDrawer(
      <RecordDrawer recordId={RECORD.id} onClose={() => undefined} onOpenRecord={onOpenRecord} />,
      { ...ME, permissions: ['dataset.read'] },
    );
    const section = await screen.findByRole('region', { name: 'Harmonisation' });
    await userEvent.click(
      within(section).getByRole('button', { name: /^Harmonises record …000001$/ }),
    );
    expect(onOpenRecord).toHaveBeenCalledWith('pending-000001');
    const harmonised = within(section).getAllByRole('button', { name: /^Harmonised as record …/ });
    expect(harmonised.map((b) => b.textContent)).toEqual([
      'Harmonised as record …000002',
      'Harmonised as record …000003',
    ]);
  });

  it('names the linked records without buttons when no onOpenRecord is given', async () => {
    dataset.fetchRecord.mockResolvedValue({
      ...RECORD_DETAIL,
      supersedes: { id: 'pending-000001' },
      supersededBy: [{ id: 'harmonised-000002' }],
    });
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    const section = await screen.findByRole('region', { name: 'Harmonisation' });
    expect(section).toHaveTextContent('Harmonises record …000001');
    expect(section).toHaveTextContent('Harmonised as record …000002');
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });

  it('omits the section when the record neither supersedes nor is superseded', async () => {
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    await screen.findByText('Dioecious');
    expect(screen.queryByRole('region', { name: 'Harmonisation' })).not.toBeInTheDocument();
  });
});

describe('RFC-70 R6 RecordDrawer responses', () => {
  const VIEWER = { ...ME, permissions: ['dataset.read'] };
  const short = (id: string) => `…${id.slice(-6)}`;

  it('badges the record an answer responds to and opens it in the same drawer', async () => {
    dataset.fetchRecord.mockResolvedValue(CONTEST_RECORD_DETAIL);
    const onOpenRecord = vi.fn();
    renderDrawer(
      <RecordDrawer
        recordId={CONTEST_RECORD_DETAIL.id}
        onClose={() => undefined}
        onOpenRecord={onOpenRecord}
      />,
      VIEWER,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: `contests record ${short(RECORD.id)}` }),
    );
    expect(onOpenRecord).toHaveBeenCalledWith(RECORD.id);
  });

  it('reads a complement as complementing the record it answers', async () => {
    dataset.fetchRecord.mockResolvedValue({ ...CONTEST_RECORD_DETAIL, intent: 'complement' });
    renderDrawer(
      <RecordDrawer recordId={CONTEST_RECORD_DETAIL.id} onClose={() => undefined} />,
      VIEWER,
    );
    expect(await screen.findByText(`complements record ${short(RECORD.id)}`)).toBeInTheDocument();
  });

  it('badges a categorical contest record, which answers no single record, with its intent alone', async () => {
    dataset.fetchRecord.mockResolvedValue({ ...CONTEST_RECORD_DETAIL, respondsTo: null });
    renderDrawer(
      <RecordDrawer recordId={CONTEST_RECORD_DETAIL.id} onClose={() => undefined} />,
      VIEWER,
    );
    expect(await screen.findByText('contest', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^contests record/ })).not.toBeInTheDocument();
  });

  it('shows no badge on a record that answers nothing', async () => {
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, VIEWER);
    await screen.findByText('Dioecious');
    expect(screen.queryByText(/^contests record/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^complements record/)).not.toBeInTheDocument();
    expect(screen.queryByText('contest', { exact: true })).not.toBeInTheDocument();
  });

  it('lists the records that answer this one, with an author only where there is one', async () => {
    dataset.fetchRecord.mockResolvedValue(RESPONDED_RECORD_DETAIL);
    const onOpenRecord = vi.fn();
    renderDrawer(
      <RecordDrawer recordId={RECORD.id} onClose={() => undefined} onOpenRecord={onOpenRecord} />,
      VIEWER,
    );
    const section = await screen.findByRole('region', { name: 'Responses' });
    const [contest, complement] = within(section).getAllByRole('listitem');
    expect(contest).toHaveTextContent('contests');
    expect(contest).toHaveTextContent('Grace');
    expect(contest).toHaveTextContent('2026-09-06');
    expect(complement).toHaveTextContent('complements');
    expect(complement).toHaveTextContent('\u2014');

    await userEvent.click(
      within(contest as HTMLElement).getByRole('button', {
        name: `Open record ${short(CONTEST_RECORD_DETAIL.id)}`,
      }),
    );
    expect(onOpenRecord).toHaveBeenCalledWith(CONTEST_RECORD_DETAIL.id);
  });

  it('omits the section from a record nothing answers', async () => {
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, VIEWER);
    await screen.findByText('Dioecious');
    expect(screen.queryByRole('region', { name: 'Responses' })).not.toBeInTheDocument();
  });
});

describe('RFC-70 R4 RecordDrawer annotations', () => {
  const VIEWER = { ...ME, permissions: ['dataset.read'] };

  it('names the reference that supports an annotation and marks a generated one', async () => {
    dataset.fetchRecord.mockResolvedValue(RESPONDED_RECORD_DETAIL);
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, VIEWER);
    const heading = await screen.findByRole('heading', { name: 'Annotations' });
    const [generated, supported] = within(heading.parentElement as HTMLElement).getAllByRole(
      'listitem',
    );
    expect(generated).toHaveTextContent('automatic');
    expect(supported).not.toHaveTextContent('automatic');
    expect(supported).toHaveTextContent('supported by Renner2014');
    expect(generated).not.toHaveTextContent('supported by');
  });
});

describe('RFC-61 R4 RecordDrawer references', () => {
  it('never shows a personal observation by its key', async () => {
    dataset.fetchRecord.mockResolvedValue(CONTEST_RECORD_DETAIL);
    renderDrawer(<RecordDrawer recordId={CONTEST_RECORD_DETAIL.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    expect(
      await screen.findByRole('link', { name: 'Personal observation (Grace)' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(GRACE_PERSONAL_OBSERVATION_REFERENCE.citationKey),
    ).not.toBeInTheDocument();
  });

  it("RFC-61 R7 sources the contest's personal observation from its own creator, never another actor's", () => {
    expect(CONTEST_RECORD_DETAIL.primaryReference).toBe(GRACE_PERSONAL_OBSERVATION_REFERENCE);
    expect(GRACE_PERSONAL_OBSERVATION_REFERENCE.citationKey).toBe(
      `personal-observation:${CONTEST_RECORD_DETAIL.createdBy?.id}`,
    );
  });
});

describe('spec §2 RecordDrawer record ID and contested flag', () => {
  it('names the record by its ID and flags it Contested (R-2, R-9)', async () => {
    dataset.fetchRecord.mockResolvedValue({
      ...RECORD_DETAIL,
      recordCode: 'EB_42',
      contested: true,
    });
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, {
      ...ME,
      permissions: ['dataset.read'],
    });
    expect(await screen.findByText('Record ID')).toBeInTheDocument();
    expect(screen.getByText('Record ID').nextElementSibling).toHaveTextContent('EB_42');
    expect(screen.getByText('Contested')).toBeInTheDocument();
  });
});

describe('R-13 RecordDrawer withdrawal', () => {
  it('closes once the author confirmed the withdrawal: the record has left the dataset', async () => {
    const mine = {
      ...RECORD_DETAIL,
      origin: 'manual' as const,
      createdBy: { id: ME.user.id, name: ME.user.name },
    };
    dataset.fetchRecord.mockResolvedValue(mine);
    curation.annotateRecord.mockResolvedValue(null);
    const onClose = vi.fn();
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={onClose} />, {
      ...ME,
      permissions: ['dataset.read', 'records.annotate'],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const confirm = await screen.findByRole('dialog', { name: 'Withdraw this record?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(curation.annotateRecord).toHaveBeenCalledWith(RECORD_DETAIL.id, { kind: 'withdraw' });
  });
});

describe('RFC-63 R8 RecordDrawer value fields, unit, unit status and provenance (issues #223, #232, #256)', () => {
  const LABELS = [
    'Single value',
    'Mean',
    'Median',
    'Min',
    'Max',
    'SD',
    'SE',
    'n',
    'Unit status',
    'Source folder',
    'Source file',
    'Name match',
    'GBIF genus',
    'GBIF family',
    'Taxon order (source)',
    'Summary source',
    'Records behind row',
  ];

  it('shows each field by its name when present, and no statistic or folded records', async () => {
    dataset.fetchRecord.mockResolvedValue({
      ...RECORD_DETAIL,
      level: null,
      valueText: '9.3;min=6.2;max=18.8;mean=9;median=8.5;sd=0.5;se=0.1;n=30',
      numericValue: 9.3,
      unitStatus: 'needs_unit_check',
      quantitative: {
        single: 9.3,
        mean: 9,
        median: 8.5,
        min: 6.2,
        max: 18.8,
        sd: 0.5,
        se: 0.1,
        n: 30,
      },
      sourceFolder: 'GIFT',
      sourceFile: 'a.csv',
      taxonomicStatus: 'resolved synonym',
      gbifGenus: 'Inga',
      gbifFamily: 'Fabaceae',
      taxonOrder: 'Fabales',
      unit: 'g',
      summarySource: 'reported_and_derived',
      recordsBehindRow: 3,
    });
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, ME);
    await screen.findByText('GIFT');
    const value = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
    // issue #256: the record's own unit, not the trait's.
    expect(value('Single value')).toBe('9.3 g');
    expect(value('Unit')).toBe('g');
    expect(value('Mean')).toBe('9');
    expect(value('Median')).toBe('8.5');
    expect(value('Min')).toBe('6.2');
    expect(value('Max')).toBe('18.8');
    expect(value('SD')).toBe('0.5');
    expect(value('SE')).toBe('0.1');
    expect(value('n')).toBe('30');
    expect(value('Unit status')).toBe('unit not checked');
    expect(value('Source folder')).toBe('GIFT');
    expect(value('Source file')).toBe('a.csv');
    expect(value('Name match')).toBe('resolved synonym');
    expect(value('GBIF genus')).toBe('Inga');
    expect(value('GBIF family')).toBe('Fabaceae');
    expect(value('Taxon order (source)')).toBe('Fabales');
    expect(value('Summary source')).toBe('reported_and_derived');
    expect(value('Records behind row')).toBe('3');
    expect(screen.queryByText('Statistic', { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.queryByText('Folded records', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('shows none of them when absent', async () => {
    dataset.fetchRecord.mockResolvedValue(RECORD_DETAIL);
    renderDrawer(<RecordDrawer recordId={RECORD.id} onClose={() => undefined} />, ME);
    await screen.findByText('Dioecious');
    for (const label of LABELS) {
      expect(screen.queryByText(label, { selector: 'dt' })).not.toBeInTheDocument();
    }
  });
});
