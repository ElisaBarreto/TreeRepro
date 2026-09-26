import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ME } from '../test/fixtures.ts';
import { renderWithProviders } from '../test/render.tsx';
import { SettingsPage } from './SettingsPage.tsx';

vi.mock('../api/me.ts', () => ({
  updateName: vi.fn(),
  listSessions: vi.fn().mockResolvedValue([]),
  revokeSession: vi.fn(),
  listApiKeys: vi.fn().mockResolvedValue({ eligible: false, keys: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));
vi.mock('../api/auth.ts', () => ({
  changePassword: vi.fn(),
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
  logoutAll: vi.fn(),
  fetchMe: vi.fn(),
}));
vi.mock('qrcode', () => ({ toCanvas: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

describe('RFC-13 R2 SettingsPage', () => {
  it('shows the four sections', async () => {
    renderWithProviders(<SettingsPage />, { me: ME });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    for (const name of ['Profile', 'Password', 'Two-factor authentication', 'Sessions']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });
});
