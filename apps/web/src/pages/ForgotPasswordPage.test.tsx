import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { renderWithProviders } from '../test/render.tsx';
import { ForgotPasswordPage } from './ForgotPasswordPage.tsx';

// fetchMe stays in the factory even though this file never calls it: `session.ts`
// (imported transitively via `renderWithProviders`) reads it at module scope.
const auth = vi.hoisted(() => ({ forgotPassword: vi.fn(), fetchMe: vi.fn() }));
vi.mock('../api/auth.ts', () => auth);

beforeEach(() => auth.forgotPassword.mockReset());

describe('RFC-21 R5 ForgotPasswordPage', () => {
  it('sends the email and shows the same sentence whatever the account', async () => {
    auth.forgotPassword.mockResolvedValue(undefined);
    renderWithProviders(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If that email has an account, a reset link is on its way.',
    );
    expect(auth.forgotPassword).toHaveBeenCalledWith('ada@example.org');
  });

  it('rejects an invalid email locally and maps RATE_LIMITED', async () => {
    renderWithProviders(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(auth.forgotPassword).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.org');
    auth.forgotPassword.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'x'));
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Wait a moment and try again.',
    );
  });
});
