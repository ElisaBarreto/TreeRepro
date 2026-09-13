import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
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
        { path: 'newPassword', message: 'Use at least 12 characters' },
      ]),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
  });
});
