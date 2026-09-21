import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { LoginForm } from './LoginForm.tsx';

const auth = vi.hoisted(() => ({ login: vi.fn(), loginTotp: vi.fn() }));
vi.mock('../../api/auth.ts', () => auth);

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
  auth.loginTotp.mockReset();
});

async function fillCredentials() {
  const typing = userEvent.setup();
  await typing.type(screen.getByLabelText('Email'), 'ada@example.org');
  await typing.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  return typing;
}

describe('RFC-22 R2-R3 LoginForm', () => {
  it('submits email and password and reports the signed-in user', async () => {
    auth.login.mockResolvedValue({ status: 'ok', user });
    const onSignedIn = vi.fn();
    render(<LoginForm onSignedIn={onSignedIn} />);

    const typing = await fillCredentials();
    await typing.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user));
    expect(auth.login).toHaveBeenCalledWith({
      email: 'ada@example.org',
      password: 'hunter2hunter2',
    });
  });

  it('toggles password visibility', async () => {
    render(<LoginForm onSignedIn={vi.fn()} />);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('shows one message for unknown email and wrong password', async () => {
    auth.login.mockRejectedValue(
      new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password'),
    );
    render(<LoginForm onSignedIn={vi.fn()} />);
    const typing = await fillCredentials();
    await typing.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('explains suspension, rate limiting and network failures', async () => {
    const cases: Array<[ApiError, string]> = [
      [new ApiError(403, 'AUTH_ACCOUNT_SUSPENDED', 'Account suspended'), 'suspended'],
      [new ApiError(429, 'RATE_LIMITED', 'Too many requests'), 'Too many attempts'],
      [new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server'), 'Could not reach'],
    ];
    for (const [error, fragment] of cases) {
      auth.login.mockRejectedValueOnce(error);
      const view = render(<LoginForm onSignedIn={vi.fn()} />);
      const typing = await fillCredentials();
      await typing.click(screen.getByRole('button', { name: 'Sign in' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(fragment);
      view.unmount();
    }
  });

  it('disables the button while the request is in flight and re-enables it on an error', async () => {
    let reject: (reason: unknown) => void = () => {};
    auth.login.mockReturnValue(new Promise((_, r) => (reject = r)));
    render(<LoginForm onSignedIn={vi.fn()} />);
    const typing = await fillCredentials();
    const button = screen.getByRole('button', { name: 'Sign in' });
    await typing.click(button);
    expect(button).toBeDisabled();
    reject(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('RFC-13 R7 stays disabled after a successful sign-in and ignores a second submit', async () => {
    auth.login.mockResolvedValue({ status: 'ok', user });
    const onSignedIn = vi.fn();
    render(<LoginForm onSignedIn={onSignedIn} />);
    const typing = await fillCredentials();
    const button = screen.getByRole('button', { name: 'Sign in' });
    await typing.click(button);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    // the page is leaving: the form must not post the credentials again
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    await waitFor(() => expect(auth.login).toHaveBeenCalledTimes(1));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });
});

describe('RFC-23 R6 second step', () => {
  it('asks for a code when the API answers totp_required, then signs in', async () => {
    auth.login.mockResolvedValue({ status: 'totp_required' });
    auth.loginTotp.mockResolvedValue({ status: 'ok', user });
    const onSignedIn = vi.fn();
    render(<LoginForm onSignedIn={onSignedIn} />);

    const typing = await fillCredentials();
    await typing.click(screen.getByRole('button', { name: 'Sign in' }));

    const code = await screen.findByLabelText('Verification code');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await typing.type(code, '123456');
    await typing.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user));
    expect(auth.loginTotp).toHaveBeenCalledWith('123456');
  });

  it('returns to the credentials step when the challenge expired', async () => {
    auth.login.mockResolvedValue({ status: 'totp_required' });
    auth.loginTotp.mockRejectedValue(new ApiError(401, 'AUTH_MFA_EXPIRED', 'Challenge expired'));
    render(<LoginForm onSignedIn={vi.fn()} />);

    const typing = await fillCredentials();
    await typing.click(screen.getByRole('button', { name: 'Sign in' }));
    await typing.type(await screen.findByLabelText('Verification code'), '123456');
    await typing.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('keeps the code step on a wrong code', async () => {
    auth.login.mockResolvedValue({ status: 'totp_required' });
    auth.loginTotp.mockRejectedValue(new ApiError(401, 'AUTH_TOTP_INVALID', 'Invalid code'));
    render(<LoginForm onSignedIn={vi.fn()} />);

    const typing = await fillCredentials();
    await typing.click(screen.getByRole('button', { name: 'Sign in' }));
    await typing.type(await screen.findByLabelText('Verification code'), '000000');
    await typing.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not valid');
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
  });
});
