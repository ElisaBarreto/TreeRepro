import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { renderWithProviders } from '../test/render.tsx';
import { ResetPasswordPage } from './ResetPasswordPage.tsx';

// fetchMe stays in the factory even though this file never calls it: `session.ts`
// (imported transitively via `renderWithProviders`) reads it at module scope.
const auth = vi.hoisted(() => ({ resetPassword: vi.fn(), fetchMe: vi.fn() }));
vi.mock('../api/auth.ts', () => auth);
const TOKEN = 't'.repeat(43);
const PASSPHRASE = 'a long enough passphrase';

beforeEach(() => {
  auth.resetPassword.mockReset();
});

describe('RFC-21 R6 ResetPasswordPage', () => {
  it('resets and shows the done state with a link to sign in', async () => {
    auth.resetPassword.mockResolvedValue(undefined);
    renderWithProviders(<ResetPasswordPage token={TOKEN} />);
    await userEvent.type(screen.getByLabelText('New password'), PASSPHRASE);
    await userEvent.type(screen.getByLabelText('Confirm password'), PASSPHRASE);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your password is changed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/');
    expect(auth.resetPassword).toHaveBeenCalledWith(TOKEN, PASSPHRASE);
  });

  it('maps AUTH_TOKEN_INVALID', async () => {
    auth.resetPassword.mockRejectedValue(new ApiError(400, 'AUTH_TOKEN_INVALID', 'x'));
    renderWithProviders(<ResetPasswordPage token={TOKEN} />);
    await userEvent.type(screen.getByLabelText('New password'), PASSPHRASE);
    await userEvent.type(screen.getByLabelText('Confirm password'), PASSPHRASE);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is no longer valid. Request a new one.',
    );
  });
});
