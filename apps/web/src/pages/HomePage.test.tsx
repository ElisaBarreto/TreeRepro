import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { renderWithProviders } from '../test/render.tsx';
import { HomePage } from './HomePage.tsx';

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../api/auth.ts', () => auth);

const user = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e',
  email: 'ada@example.org',
  name: 'Ada',
  status: 'active' as const,
  totpEnabled: false,
  createdAt: '2026-09-12T00:00:00.000Z',
};

beforeEach(() => {
  auth.login.mockReset();
  auth.fetchMe.mockReset();
  auth.logout.mockReset();
  auth.fetchMe.mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Sign in first'));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('RFC-13 R2 HomePage', () => {
  it('renders the product name', async () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByRole('heading', { name: 'TreeRepro' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('shows the emblem and the sign-in form to a visitor without a session', async () => {
    renderWithProviders(<HomePage />);
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /TreeRepro emblem/ })).toBeInTheDocument();
    expect(screen.getByText(/Invitation only/)).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });

  it('greets a signed-in user instead of asking for credentials', async () => {
    auth.fetchMe.mockResolvedValue({ user, permissions: [] });
    renderWithProviders(<HomePage />);
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('switches to the signed-in view after a successful login', async () => {
    auth.login.mockResolvedValue({ status: 'ok', user });
    renderWithProviders(<HomePage />);
    const typing = userEvent.setup();
    await typing.type(await screen.findByLabelText('Email'), 'ada@example.org');
    await typing.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    auth.fetchMe.mockResolvedValue({ user, permissions: [] });
    await typing.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
  });

  it('signs out and returns to the form', async () => {
    auth.fetchMe.mockResolvedValue({ user, permissions: [] });
    auth.logout.mockResolvedValue(undefined);
    renderWithProviders(<HomePage />);
    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    auth.fetchMe.mockRejectedValue(new ApiError(401, 'AUTH_UNAUTHENTICATED', 'Sign in first'));
    await userEvent.click(signOut);
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });
});
