import { screen, within } from '@testing-library/react';
import type { MeResponse } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_BATCH } from '../../test/dataset-fixtures.ts';
import { ADMIN_ME, ME } from '../../test/fixtures.ts';
import { PLATFORM_HEALTH, PLATFORM_HEALTH_EMPTY } from '../../test/health-fixtures.ts';
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
const admin = vi.hoisted(() => ({ fetchPlatformHealth: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/admin.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/admin.ts')>()),
  ...admin,
}));

beforeEach(() => {
  auth.fetchMe.mockReset().mockResolvedValue(ADMIN_ME);
  admin.fetchPlatformHealth.mockReset().mockResolvedValue(PLATFORM_HEALTH);
});

async function openPage() {
  renderAt('/app/admin/health');
  await screen.findByRole('heading', { name: 'Platform health' });
  // The query resolves a tick after the route mounts; wait for a group that
  // is always present once `health.data` has landed before asserting on it.
  return screen.findByRole('list', { name: 'User totals' });
}

function sectionByHeading(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const section = heading.closest('section');
  if (!section) throw new Error(`no <section> ancestor for heading "${name}"`);
  return section as HTMLElement;
}

describe('RFC-52 HealthPage', () => {
  it('RFC-13 R3 shows NoPermission without health.read', async () => {
    const noHealth: MeResponse = { ...ME, permissions: ['admin.access'] };
    auth.fetchMe.mockResolvedValue(noHealth);
    renderAt('/app/admin/health');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this area.',
    );
    expect(admin.fetchPlatformHealth).not.toHaveBeenCalled();
  });

  it('RFC-13 R3 breadcrumbs Admin › Health', async () => {
    await openPage();
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(trail).toHaveTextContent('Admin');
    expect(trail).toHaveTextContent('Health');
  });

  it('renders a tile per group with the counts from the API', async () => {
    await openPage();
    const users = screen.getByRole('list', { name: 'User totals' });
    expect(within(users).getByText('12')).toBeInTheDocument();
    expect(within(users).getByText('2')).toBeInTheDocument();
    expect(within(users).getByText('1')).toBeInTheDocument();
    expect(within(users).getByText('9')).toBeInTheDocument();
    expect(within(users).getByText('11')).toBeInTheDocument();

    const dataset = screen.getByRole('list', { name: 'Dataset totals' });
    expect(within(dataset).getByText('100')).toBeInTheDocument();
    expect(within(dataset).getByText('90')).toBeInTheDocument();
    expect(within(dataset).getByText('5,000')).toBeInTheDocument();

    const activity = screen.getByRole('list', { name: 'Activity totals' });
    expect(within(activity).getByText('42')).toBeInTheDocument();
    expect(within(activity).getByText('8')).toBeInTheDocument();
    expect(within(activity).getByText('3')).toBeInTheDocument();

    const queues = screen.getByRole('list', { name: 'Queue totals' });
    expect(within(queues).getByText('4')).toBeInTheDocument();
    expect(within(queues).getByText('2')).toBeInTheDocument();
    expect(within(queues).getByText('1')).toBeInTheDocument();
    expect(within(queues).getByText('5')).toBeInTheDocument();
  });

  it('renders the two meters against their own denominators (RFC-52 ruling R-G)', async () => {
    await openPage();
    // acceptedCells / coverageCells
    expect(screen.getByText('900 / 1,200')).toBeInTheDocument();
    // coverageCells / (activeSpecies × activeTraits) = 1200 / (90 × 18)
    expect(screen.getByText('1,200 / 1,620')).toBeInTheDocument();
  });

  it('ruling R-C: a zero denominator renders 0% and a — label on both meters', async () => {
    admin.fetchPlatformHealth.mockResolvedValue(PLATFORM_HEALTH_EMPTY);
    await openPage();
    const dataset = screen.getByRole('list', { name: 'Dataset totals' });
    expect(within(dataset).getAllByText('—')).toHaveLength(2);
    expect(within(dataset).getAllByText('0%')).toHaveLength(2);
  });

  it('renders the 14-day activity table', async () => {
    await openPage();
    const section = sectionByHeading('Activity, last 7 days');
    const rows = within(section).getAllByRole('row');
    expect(rows).toHaveLength(15); // header + 14 days
  });

  it('renders the two job rows with badges', async () => {
    await openPage();
    const section = sectionByHeading('Jobs');
    expect(within(section).getByText('Digest')).toBeInTheDocument();
    expect(within(section).getByText('Audit purge')).toBeInTheDocument();
    expect(within(section).getByText('completed')).toBeInTheDocument();
    expect(within(section).getByText('failed')).toBeInTheDocument();
  });

  it('renders the imports table with a link to /app/imports/$id', async () => {
    await openPage();
    const section = sectionByHeading('Recent imports');
    const link = within(section).getByRole('link', { name: IMPORT_BATCH.fileName });
    expect(link).toHaveAttribute('href', `/app/imports/${IMPORT_BATCH.id}`);
  });
});
