import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { CURATED_RECORD_DETAIL, DISPUTED_RECORD } from '../../test/dataset-fixtures.ts';
import { ME } from '../../test/fixtures.ts';
import { renderAt } from '../../test/router.tsx';

const auth = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  loginTotp: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
}));
const dataset = vi.hoisted(() => ({ fetchRecord: vi.fn() }));
const curation = vi.hoisted(() => ({ fetchDisputed: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('../../api/dataset.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dataset.ts')>()),
  ...dataset,
}));
vi.mock('../../api/curation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/curation.ts')>()),
  ...curation,
}));

beforeEach(() => {
  auth.fetchMe
    .mockReset()
    .mockResolvedValue({ ...ME, permissions: ['dataset.read', 'records.review'] });
  dataset.fetchRecord.mockReset().mockResolvedValue(CURATED_RECORD_DETAIL);
  curation.fetchDisputed
    .mockReset()
    .mockResolvedValue({ data: [DISPUTED_RECORD], meta: { nextCursor: null } });
});

describe('RFC-65 R10 DisputedPage', () => {
  it('lists disputed records with species, trait, value, disputer, note and date; a row opens the record drawer', async () => {
    renderAt('/app/curation/disputed');
    const rows = (await screen.findAllByRole('row')).slice(1);
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(within(row).getByRole('link', { name: /Adenanthera pavonina/ })).toHaveAttribute(
      'href',
      `/app/species/${DISPUTED_RECORD.speciesId}`,
    );
    expect(row).toHaveTextContent('seed mass');
    expect(row).toHaveTextContent('Grace');
    expect(row).toHaveTextContent('Value is not a number.');
    expect(row).toHaveTextContent('2026-09-03');
    await userEvent.click(within(row).getByRole('button', { name: /about two/ }));
    expect(await screen.findByRole('dialog', { name: 'Record' })).toBeInTheDocument();
    expect(dataset.fetchRecord).toHaveBeenCalledWith(DISPUTED_RECORD.id);
  });

  it('shows the empty state', async () => {
    curation.fetchDisputed.mockResolvedValue({ data: [], meta: { nextCursor: null } });
    renderAt('/app/curation/disputed');
    expect(await screen.findByText('No standing disputes.')).toBeInTheDocument();
  });

  it('RFC-13 R4 a 403 shows the permission sentence; other failures the generic one', async () => {
    curation.fetchDisputed.mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'x'));
    const first = renderAt('/app/curation/disputed');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to do this.',
    );
    expect(screen.queryByText('No standing disputes.')).not.toBeInTheDocument();
    first.unmount();

    curation.fetchDisputed.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderAt('/app/curation/disputed');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('RFC-13 R8 a 401 on the list ends the session and returns to /', async () => {
    curation.fetchDisputed.mockRejectedValue(
      new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Authentication required'),
    );
    const { router } = renderAt('/app/curation/disputed');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
