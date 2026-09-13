import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { ME_QUERY_KEY } from '../../lib/session.ts';
import { ME, USER } from '../../test/fixtures.ts';
import { renderWithProviders } from '../../test/render.tsx';
import { TotpSection } from './TotpSection.tsx';

const auth = vi.hoisted(() => ({
  totpSetup: vi.fn(),
  totpConfirm: vi.fn(),
  totpDisable: vi.fn(),
  fetchMe: vi.fn(),
}));
vi.mock('../../api/auth.ts', () => auth);
vi.mock('qrcode', () => ({ toCanvas: vi.fn().mockResolvedValue(undefined) }));
const CODES = Array.from({ length: 10 }, (_, i) => `abcde-fgh${i}${i}`);

beforeEach(() => {
  auth.totpSetup.mockReset();
  auth.totpConfirm.mockReset();
  auth.totpDisable.mockReset();
});

describe('RFC-23 R2, R3 enabling TOTP', () => {
  it('sets up, shows the secret, confirms, shows the recovery codes once, and flips the session flag', async () => {
    auth.totpSetup.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/TreeRepro:ada?secret=JBSWY3DPEHPK3PXP',
    });
    auth.totpConfirm.mockResolvedValue(CODES);
    const { queryClient } = renderWithProviders(<TotpSection />, { me: ME });
    expect(screen.getByText('Two-factor authentication is off.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText(CODES[0] ?? '')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(auth.totpConfirm).toHaveBeenCalledWith('123456');
    await userEvent.click(screen.getByRole('button', { name: 'I saved these codes' }));
    expect(screen.queryByText(CODES[0] ?? '')).not.toBeInTheDocument();
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument();
    expect(screen.getByText('Two-factor authentication is on.')).toBeInTheDocument();
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toMatchObject({ user: { totpEnabled: true } });
    // The secret and the codes leave the MutationCache too, not only the screen.
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
  });

  it('maps a wrong code', async () => {
    auth.totpSetup.mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' });
    auth.totpConfirm.mockRejectedValue(new ApiError(401, 'AUTH_TOTP_INVALID', 'x'));
    renderWithProviders(<TotpSection />, { me: ME });
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.type(await screen.findByLabelText('Verification code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');
  });

  it('validates the code locally before calling the API', async () => {
    auth.totpSetup.mockResolvedValue({ secret: 'S', otpauthUri: 'otpauth://totp/x' });
    renderWithProviders(<TotpSection />, { me: ME });
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.type(await screen.findByLabelText('Verification code'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(
      await screen.findByText('Enter the six-digit code from your authenticator app.'),
    ).toBeInTheDocument();
    expect(auth.totpConfirm).not.toHaveBeenCalled();
  });
});

describe('RFC-23 R7 disabling TOTP', () => {
  it('asks for password and code in a dialog, then flips the flag', async () => {
    auth.totpDisable.mockResolvedValue(undefined);
    const { queryClient } = renderWithProviders(<TotpSection />, {
      me: { ...ME, user: { ...USER, totpEnabled: true } },
    });
    expect(screen.getByText('Two-factor authentication is on.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disable two-factor authentication' });
    expect(dialog).toHaveAttribute('open');
    await userEvent.type(screen.getByLabelText('Password'), 'my passphrase');
    await userEvent.type(screen.getByLabelText('Code or recovery code'), 'abcde-fghij');
    await userEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    await waitFor(() =>
      expect(auth.totpDisable).toHaveBeenCalledWith({
        password: 'my passphrase',
        recoveryCode: 'abcde-fghij',
      }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(ME_QUERY_KEY)).toMatchObject({
        user: { totpEnabled: false },
      }),
    );
  });

  it('accepts a six-digit code alongside the password', async () => {
    auth.totpDisable.mockResolvedValue(undefined);
    renderWithProviders(<TotpSection />, { me: { ...ME, user: { ...USER, totpEnabled: true } } });
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await screen.findByRole('dialog', { name: 'Disable two-factor authentication' });
    await userEvent.type(screen.getByLabelText('Password'), 'my passphrase');
    await userEvent.type(screen.getByLabelText('Code or recovery code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    await waitFor(() =>
      expect(auth.totpDisable).toHaveBeenCalledWith({ password: 'my passphrase', code: '123456' }),
    );
  });

  it('validates the password and the code locally before calling the API', async () => {
    renderWithProviders(<TotpSection />, { me: { ...ME, user: { ...USER, totpEnabled: true } } });
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await screen.findByRole('dialog', { name: 'Disable two-factor authentication' });
    await userEvent.type(screen.getByLabelText('Password'), 'my passphrase');
    await userEvent.type(screen.getByLabelText('Code or recovery code'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    expect(
      await screen.findByText('Enter a six-digit code or a recovery code.'),
    ).toBeInTheDocument();
    expect(auth.totpDisable).not.toHaveBeenCalled();
  });

  it('requires a password even when the code is valid', async () => {
    renderWithProviders(<TotpSection />, { me: { ...ME, user: { ...USER, totpEnabled: true } } });
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await userEvent.type(await screen.findByLabelText('Code or recovery code'), 'abcde-fghij');
    await userEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    expect(await screen.findByText('Enter your password.')).toBeInTheDocument();
    expect(auth.totpDisable).not.toHaveBeenCalled();
  });

  it('forgets a failed attempt after Cancel: no stale error, no retained password', async () => {
    auth.totpDisable.mockRejectedValueOnce(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'));
    renderWithProviders(<TotpSection />, { me: { ...ME, user: { ...USER, totpEnabled: true } } });
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await screen.findByRole('dialog', { name: 'Disable two-factor authentication' });
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.type(screen.getByLabelText('Code or recovery code'), 'abcde-fghij');
    await userEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your password is incorrect.');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});
