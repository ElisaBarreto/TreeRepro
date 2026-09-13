import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { USER } from '../test/fixtures.ts';
import { renderWithProviders } from '../test/render.tsx';
import { InvitePage } from './InvitePage.tsx';

// fetchMe stays in the factory even though this file never calls it: `session.ts`
// (imported transitively via `renderWithProviders`) reads it at module scope.
const auth = vi.hoisted(() => ({ acceptInvite: vi.fn(), fetchMe: vi.fn() }));
vi.mock('../api/auth.ts', () => auth);
const TOKEN = 't'.repeat(43);
const PASSPHRASE = 'a long enough passphrase';

beforeEach(() => {
  auth.acceptInvite.mockReset();
});

describe('RFC-20 R6 InvitePage', () => {
  it('accepts with matching passwords and reports success', async () => {
    auth.acceptInvite.mockResolvedValue(USER);
    const onAccepted = vi.fn();
    renderWithProviders(<InvitePage token={TOKEN} onAccepted={onAccepted} />);
    await userEvent.type(screen.getByLabelText('New password'), PASSPHRASE);
    await userEvent.type(screen.getByLabelText('Confirm password'), PASSPHRASE);
    await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(auth.acceptInvite).toHaveBeenCalledWith(TOKEN, PASSPHRASE);
  });

  it('refuses a mismatch locally and maps AUTH_TOKEN_INVALID and AUTH_PASSWORD_WEAK', async () => {
    renderWithProviders(<InvitePage token={TOKEN} onAccepted={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('New password'), PASSPHRASE);
    await userEvent.type(screen.getByLabelText('Confirm password'), 'something else entirely');
    await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(auth.acceptInvite).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), PASSPHRASE);
    auth.acceptInvite.mockRejectedValueOnce(new ApiError(400, 'AUTH_TOKEN_INVALID', 'x'));
    await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation is no longer valid. Ask an administrator to send a new one.',
    );

    auth.acceptInvite.mockRejectedValueOnce(
      new ApiError(400, 'AUTH_PASSWORD_WEAK', 'x', [
        { path: 'password', message: 'This password appears in a breach' },
      ]),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    expect(await screen.findByText('This password appears in a breach')).toBeInTheDocument();
  });
});
