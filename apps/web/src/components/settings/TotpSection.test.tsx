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
    expect(screen.getByText('Two-factor authentication is on.')).toBeInTheDocument();
    expect(queryClient.getQueryData(ME_QUERY_KEY)).toMatchObject({ user: { totpEnabled: true } });
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
    expect(dialog).toBeInTheDocument();
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
});
