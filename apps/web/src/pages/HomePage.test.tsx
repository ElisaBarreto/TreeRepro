import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVEAL } from '../components/landing/reveal.ts';
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it('hands the user over at once, with no reveal, under prefers-reduced-motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    auth.login.mockResolvedValue({ status: 'ok', user: USER });
    const onSignedIn = vi.fn();
    renderWithProviders(<HomePage onSignedIn={onSignedIn} />);
    await signIn();
    expect(onSignedIn).toHaveBeenCalledWith(USER, 'none');
    expect(screen.getByRole('region', { name: 'Sign in to TreeRepro' })).not.toHaveClass(
      'tr-recede',
    );
  });
});

describe('RFC-13 R7 sign-in reveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 356,
      bottom: 356,
      width: 256,
      height: 256,
      toJSON: () => ({}),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recedes, grows toward the centre of the viewport, then leaves with a view transition', async () => {
    auth.login.mockResolvedValue({ status: 'ok', user: USER });
    const onSignedIn = vi.fn();
    const { container } = renderWithProviders(<HomePage onSignedIn={onSignedIn} />);
    await submitSignIn();

    const card = screen.getByRole('region', { name: 'Sign in to TreeRepro' });
    const travel = container.querySelector('.tr-travel') as HTMLElement;
    expect(card).toHaveClass('tr-recede');
    expect(travel).not.toHaveClass('tr-grow');
    expect(onSignedIn).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(REVEAL.grow));
    expect(travel).toHaveClass('tr-grow');
    expect(card).toHaveClass('tr-gone');
    // jsdom's viewport is 1024×768; the stage rect above is 256px at (100, 100)
    expect(travel.style.getPropertyValue('--tr-dx')).toBe('284px');
    expect(travel.style.getPropertyValue('--tr-dy')).toBe('156px');
    expect(onSignedIn).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(REVEAL.leave - REVEAL.grow));
    expect(onSignedIn).toHaveBeenCalledWith(USER, 'reveal');
  });

  it('shuts the receded form away and ignores a second sign-in while the reveal runs', async () => {
    auth.login.mockResolvedValue({ status: 'ok', user: USER });
    const onSignedIn = vi.fn();
    const { container } = renderWithProviders(<HomePage onSignedIn={onSignedIn} />);
    await submitSignIn();
    const formSide = container.querySelector('.tr-form-side') as HTMLElement;
    expect(formSide).toHaveAttribute('inert');
    act(() => vi.advanceTimersByTime(REVEAL.grow));

    // a second submit slipping through must neither restart the beats nor post again
    await submitSignIn();
    expect(container.querySelector('.tr-travel')).toHaveClass('tr-grow');
    expect(auth.login).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(REVEAL.leave - REVEAL.grow));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('drops the beats still to come when the page unmounts', async () => {
    auth.login.mockResolvedValue({ status: 'ok', user: USER });
    const onSignedIn = vi.fn();
    const { unmount } = renderWithProviders(<HomePage onSignedIn={onSignedIn} />);
    await submitSignIn();
    unmount();
    act(() => vi.advanceTimersByTime(REVEAL.leave + 1));
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});

async function signIn() {
  const typing = userEvent.setup();
  await typing.type(screen.getByLabelText('Email'), 'ada@example.org');
  await typing.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await typing.click(screen.getByRole('button', { name: 'Sign in' }));
}

// Under fake timers user-event's own waits never settle, so the reveal tests
// submit the form with plain events and flush the login promise by hand.
async function submitSignIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.org' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign in' }).closest('form') as HTMLFormElement,
  );
  await act(async () => {});
}
