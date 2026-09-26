import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ApiKeysSection } from './ApiKeysSection.tsx';

const me = vi.hoisted(() => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  listApiKeyEndpoints: vi.fn(),
}));
vi.mock('../../api/me.ts', () => me);

const ME_TOTP = { ...ME, user: { ...ME.user, totpEnabled: true } };

const KEY = {
  id: '0199a1b2-0000-7000-8000-000000000001',
  name: 'laptop',
  prefix: 'AbCdEfGh',
  createdAt: '2026-09-26T10:00:00.000Z',
  expiresAt: '2026-12-25T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  state: 'active' as const,
};

const ENDPOINTS = [
  { method: 'POST', path: '/api/batch', summary: 'Run up to 500 operations', permission: null },
  {
    method: 'GET',
    path: '/api/records/pending',
    summary: 'List pending groups',
    permission: 'records.review',
  },
];

beforeEach(() => {
  for (const fn of Object.values(me)) fn.mockReset();
  me.listApiKeyEndpoints.mockResolvedValue(ENDPOINTS);
});

describe('RFC-82 R7 ApiKeysSection', () => {
  it('renders nothing for a user who is not eligible', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: false, keys: [] });
    const { container } = renderWithProviders(<ApiKeysSection />, { me: ME_TOTP });
    await waitFor(() => expect(me.listApiKeys).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('creates a key, shows the secret once, and revokes a key', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: true, keys: [KEY] });
    me.createApiKey.mockResolvedValue({
      key: { ...KEY, id: '0199a1b2-0000-7000-8000-000000000002' },
      secret: 'tr_live_SECRET',
    });
    me.revokeApiKey.mockResolvedValue(undefined);
    renderWithProviders(<ApiKeysSection />, { me: ME_TOTP });

    expect(await screen.findByText('laptop')).toBeInTheDocument();
    expect(screen.getByText('tr_live_AbCdEfGh…')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Key name'), 'script');
    await userEvent.type(screen.getByLabelText('Current password'), 'pw');
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(me.createApiKey).toHaveBeenCalledWith({
      name: 'script',
      password: 'pw',
      code: '123456',
    });
    expect(await screen.findByText('tr_live_SECRET')).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Revoke laptop' }));
    expect(me.revokeApiKey).toHaveBeenCalledWith(KEY.id);
    await waitFor(() => expect(screen.queryByText('tr_live_SECRET')).not.toBeInTheDocument());
  });

  it('shows dates without the time', async () => {
    me.listApiKeys.mockResolvedValue({
      eligible: true,
      keys: [{ ...KEY, lastUsedAt: '2026-10-01T15:42:00.000Z' }],
    });
    renderWithProviders(<ApiKeysSection />, { me: ME_TOTP });
    expect(await screen.findByText('25 Dec 2026')).toBeInTheDocument();
    expect(screen.getByText('1 Oct 2026')).toBeInTheDocument();
  });

  it('asks for two-factor authentication instead of showing the form when it is off', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: true, keys: [KEY] });
    renderWithProviders(<ApiKeysSection />, { me: ME });
    expect(await screen.findByText('laptop')).toBeInTheDocument();
    expect(
      screen.getByText('Enable two-factor authentication first to create a key.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Key name')).not.toBeInTheDocument();
  });

  async function fillAndSubmitCreate() {
    await userEvent.type(screen.getByLabelText('Key name'), 'script');
    await userEvent.type(screen.getByLabelText('Current password'), 'pw');
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
  }

  it.each([
    ['AUTH_INVALID_CREDENTIALS', 'Your current password is incorrect.'],
    ['AUTH_TOTP_INVALID', 'The verification code is not valid.'],
    ['AUTH_TOTP_NOT_ENABLED', 'Enable two-factor authentication first.'],
    ['RATE_LIMITED', 'Too many attempts. Wait a moment and try again.'],
  ] as const)('maps %s to its message on a failed create', async (code, message) => {
    me.listApiKeys.mockResolvedValue({ eligible: true, keys: [] });
    me.createApiKey.mockRejectedValueOnce(new ApiError(400, code, 'x'));
    renderWithProviders(<ApiKeysSection />, { me: ME_TOTP });
    await screen.findByLabelText('Key name');
    await fillAndSubmitCreate();
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('shows the generic message for an unmapped create failure', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: true, keys: [] });
    me.createApiKey.mockRejectedValueOnce(new ApiError(500, 'UNKNOWN_ERROR', 'x'));
    renderWithProviders(<ApiKeysSection />, { me: ME_TOTP });
    await screen.findByLabelText('Key name');
    await fillAndSubmitCreate();
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });

  it('shows the generic message when revoking a key fails', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: true, keys: [KEY] });
    me.revokeApiKey.mockRejectedValueOnce(new ApiError(500, 'UNKNOWN_ERROR', 'x'));
    renderWithProviders(<ApiKeysSection />, { me: ME_TOTP });
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke laptop' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });

  it('R22 shows how to use a key and lists the endpoints, grouped and filterable', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: true, keys: [KEY] });
    renderWithProviders(<ApiKeysSection />, { me: ME_TOTP });

    expect(await screen.findByText('Authorization: Bearer tr_live_…')).toBeInTheDocument();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    await userEvent.click(await screen.findByText('Endpoints (2)'));
    expect(screen.getByRole('heading', { name: 'batch' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'records' })).toBeInTheDocument();
    expect(screen.getByText('/api/records/pending')).toBeInTheDocument();
    expect(screen.getByText('records.review')).toBeInTheDocument();
    expect(screen.getByText('key only')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Filter endpoints'), 'pending');
    expect(screen.queryByText('/api/batch')).not.toBeInTheDocument();
    expect(screen.getByText('/api/records/pending')).toBeInTheDocument();
  });

  it('R22 says so when the endpoint list fails to load', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: true, keys: [] });
    me.listApiKeyEndpoints.mockRejectedValue(new Error('down'));
    renderWithProviders(<ApiKeysSection />, { me: ME_TOTP });
    expect(await screen.findByText('The endpoint list could not be loaded.')).toBeInTheDocument();
  });
});
