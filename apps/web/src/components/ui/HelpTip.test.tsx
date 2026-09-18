import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { HelpTip } from './HelpTip.tsx';

// `learnMore` renders a router `Link`, so only the tests that use it mount
// through a minimal one-route router (the pattern RecordTable.test.tsx uses).
function renderInRouter(ui: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

describe('RFC-13 R11 HelpTip', () => {
  it('opens on click, closes on Escape, is described by the trigger', async () => {
    render(<HelpTip>Explains things.</HelpTip>);
    const button = screen.getByRole('button', { name: 'What does this mean?' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button).not.toHaveAccessibleDescription();
    await userEvent.click(button);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Explains things.');
    expect(button).toHaveAttribute('aria-controls', tip.id);
    expect(button).toHaveAccessibleDescription('Explains things.');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button).not.toHaveAccessibleDescription();
  });

  it('uses the given label for the trigger instead of the default', () => {
    render(<HelpTip label="What is a DOI?">A digital object identifier.</HelpTip>);
    expect(screen.getByRole('button', { name: 'What is a DOI?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'What does this mean?' })).not.toBeInTheDocument();
  });

  it('opens on pointer hover and closes once the pointer leaves', async () => {
    render(<HelpTip>Explains things.</HelpTip>);
    const button = screen.getByRole('button', { name: 'What does this mean?' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.hover(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await userEvent.unhover(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on focus and closes once focus blurs out to another element', () => {
    render(
      <>
        <HelpTip>Explains things.</HelpTip>
        <button type="button">Elsewhere</button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'What does this mean?' });
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(button, {
      relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }),
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not close when focus blurs from the trigger into the popover itself', async () => {
    renderInRouter(<HelpTip learnMore="/">Explains things.</HelpTip>);
    const button = await screen.findByRole('button', { name: 'What does this mean?' });
    fireEvent.focus(button);
    const link = screen.getByRole('link', { name: 'Learn more' });
    fireEvent.blur(button, { relatedTarget: link });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes on an outside pointerdown while open, but not on one inside the popover', () => {
    render(
      <>
        <HelpTip>Explains things.</HelpTip>
        <button type="button">Elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'What does this mean?' }));
    const tip = screen.getByRole('tooltip');
    fireEvent.pointerDown(tip);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders a "Learn more" link to the given route only when learnMore is set', async () => {
    renderInRouter(<HelpTip learnMore="/">Explains things.</HelpTip>);
    fireEvent.click(await screen.findByRole('button', { name: 'What does this mean?' }));
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/');
  });

  it('renders no "Learn more" link without learnMore', () => {
    render(<HelpTip>Explains things.</HelpTip>);
    fireEvent.click(screen.getByRole('button', { name: 'What does this mean?' }));
    expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument();
  });
});
