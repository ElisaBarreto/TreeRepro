import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { ME_QUERY_KEY } from '../../lib/session.ts';
import { ME } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { PasswordSection } from './PasswordSection.tsx';

const auth = vi.hoisted(() => ({ changePassword: vi.fn(), fetchMe: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);
const OLD = 'old passphrase here';
const NEW = 'new passphrase here!';

beforeEach(() => {
  auth.changePassword.mockReset();
});

async function fill(current: string, next: string, confirm: string) {
  await userEvent.type(screen.getByLabelText('Current password'), current);
  await userEvent.type(screen.getByLabelText('New password'), next);
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('RFC-21 R7 PasswordSection', () => {
  it('changes the password and clears the form', async () => {
    auth.changePassword.mockResolvedValue(undefined);
    renderWithProviders(<PasswordSection />, { me: ME });
    await fill(OLD, NEW, NEW);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password changed. Other devices were signed out.',
    );
    expect(auth.changePassword).toHaveBeenCalledWith(OLD, NEW);
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('RFC-82 R3 warns that API keys are revoked and refreshes the key list on success', async () => {
    auth.changePassword.mockResolvedValue(undefined);
    const { queryClient } = renderWithProviders(<PasswordSection />, { me: ME });
    queryClient.setQueryData(['me', 'api-keys'], { eligible: true, keys: [] });
    expect(screen.getByText('This also revokes every API key you hold.')).toBeInTheDocument();
    await fill(OLD, NEW, NEW);
    await waitFor(() =>
      expect(queryClient.getQueryState(['me', 'api-keys'])?.isInvalidated).toBe(true),
    );
  });

  it('checks the confirmation locally and maps AUTH_INVALID_CREDENTIALS and AUTH_PASSWORD_WEAK', async () => {
    renderWithProviders(<PasswordSection />, { me: ME });
    await fill(OLD, NEW, 'different');
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(auth.changePassword).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), NEW);
    auth.changePassword.mockRejectedValueOnce(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is incorrect.')).toBeInTheDocument();
    auth.changePassword.mockRejectedValueOnce(
      new ApiError(400, 'AUTH_PASSWORD_WEAK', 'x', [
        { path: 'password', message: 'Use at least 12 characters' },
      ]),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
  });

  it('shows AUTH_PASSWORD_WEAK under "New password" although the API names the field "password"', async () => {
    // passwordWeakError (apps/api/src/auth/password.ts) always answers with
    // `path: 'password'`, for the change flow too.
    auth.changePassword.mockRejectedValueOnce(
      new ApiError(400, 'AUTH_PASSWORD_WEAK', 'x', [
        { path: 'password', message: 'Use at least 12 characters' },
      ]),
    );
    renderWithProviders(<PasswordSection />, { me: ME });
    await fill(OLD, 'short', 'short');
    expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
    const field = screen.getByLabelText('New password');
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(/Use at least 12 characters/);
    expect(screen.getByLabelText('Current password')).toBeValid();
  });

  it('RFC-13 R4 runs through the MutationCache, where the 401 handler lives, and resets once settled', async () => {
    const error = new ApiError(401, 'AUTH_UNAUTHENTICATED', 'x');
    auth.changePassword.mockRejectedValueOnce(error);
    const onError = vi.fn();
    const queryClient = new QueryClient({ mutationCache: new MutationCache({ onError }) });
    queryClient.setQueryData(ME_QUERY_KEY, ME);
    render(
      <QueryClientProvider client={queryClient}>
        <PasswordSection />
      </QueryClientProvider>,
    );
    await fill(OLD, NEW, NEW);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]?.[0]).toBe(error);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    // The two passwords sat in the mutation's `variables`; they must not
    // linger in the cache while the section stays mounted (RFC-21 R7).
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
  });
});
