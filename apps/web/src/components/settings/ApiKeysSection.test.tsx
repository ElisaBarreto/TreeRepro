import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { ApiKeysSection } from './ApiKeysSection.tsx';

const me = vi.hoisted(() => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));
vi.mock('../../api/me.ts', () => me);

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

beforeEach(() => {
  for (const fn of Object.values(me)) fn.mockReset();
});

describe('RFC-82 R7 ApiKeysSection', () => {
  it('renders nothing for a user who is not eligible', async () => {
    me.listApiKeys.mockResolvedValue({ eligible: false, keys: [] });
    const { container } = renderWithProviders(<ApiKeysSection />, { me: ME });
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
    renderWithProviders(<ApiKeysSection />, { me: ME });

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
  });
});
