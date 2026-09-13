import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER } from '../test/fixtures.ts';
import { renderWithProviders } from '../test/render.tsx';
import { HomePage } from './HomePage.tsx';

// fetchMe stays in the factory even though this file never calls it: `session.ts`
// (imported transitively via `renderWithProviders`) reads it at module scope.
const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginTotp: vi.fn(),
  fetchMe: vi.fn(),
}));
vi.mock('../api/auth.ts', () => auth);

beforeEach(() => {
  auth.login.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('RFC-13 R2 HomePage', () => {
  it('renders the product name', () => {
    renderWithProviders(<HomePage onSignedIn={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'TreeRepro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('shows the emblem and the sign-in form to a visitor without a session', () => {
    renderWithProviders(<HomePage onSignedIn={vi.fn()} />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /TreeRepro emblem/ })).toBeInTheDocument();
    expect(screen.getByText(/Invitation only/)).toBeInTheDocument();
  });

  it('calls onSignedIn with the user after a successful login', async () => {
    auth.login.mockResolvedValue({ status: 'ok', user: USER });
    const onSignedIn = vi.fn();
    renderWithProviders(<HomePage onSignedIn={onSignedIn} />);
    const typing = userEvent.setup();
    await typing.type(screen.getByLabelText('Email'), 'ada@example.org');
    await typing.type(screen.getByLabelText('Password'), 'hunter2hunter2');
    await typing.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignedIn).toHaveBeenCalledWith(USER);
  });
});
