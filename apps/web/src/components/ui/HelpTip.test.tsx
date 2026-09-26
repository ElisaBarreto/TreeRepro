import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { helpHref } from '../../content/help/href.ts';
import { HelpTip } from './HelpTip.tsx';

// `learnMore` renders a router `Link`, so only the tests that use it mount
// through a minimal router (the pattern RecordTable.test.tsx uses). The tree
// also carries `/app/help/$topic`, so a "Learn more" target is a route that
// really exists and the router's own resulting location can be asserted.
function makeRouter(ui: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => ui,
  });
  const topicRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/help/$topic',
    component: () => <p>topic</p>,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, topicRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

function renderInRouter(ui: ReactElement) {
  return render(<RouterProvider router={makeRouter(ui)} />);
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

  // RFC-73 R4: every tip's "Learn more" points at a *section* of a help
  // topic. `Link`'s `to` is a pathname, not a URL, so a `#` embedded in it
  // would be percent-encoded and the link would land on a route that does
  // not exist. Asserting the href alone would not catch that; this asserts
  // where the router actually goes.
  it('RFC-73 R4 follows "Learn more" to the topic path and its hash', async () => {
    const router = makeRouter(<HelpTip learnMore={helpHref('workflow', 'contest')}>Tip.</HelpTip>);
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole('button', { name: 'What does this mean?' }));
    const link = screen.getByRole('link', { name: 'Learn more' });
    // The href matters on its own: a middle-click or "copy link address" never
    // goes through the router.
    expect(link).toHaveAttribute('href', '/app/help/workflow#contest');
    await userEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/help/workflow'));
    expect(router.state.location.hash).toBe('contest');
  });

  it('renders no "Learn more" link without learnMore', () => {
    render(<HelpTip>Explains things.</HelpTip>);
    fireEvent.click(screen.getByRole('button', { name: 'What does this mean?' }));
    expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument();
  });

  // RFC-76 R8: a trait card's tip carries a second link to its maps, beside
  // "Learn more", only when the trait has any.
  it('renders extraLink beside "Learn more" when given, and neither without it', async () => {
    const withLink = renderInRouter(
      <HelpTip
        learnMore="/"
        extraLink={{ to: '/app/maps', search: { trait: 't1' }, label: 'Maps' }}
      >
        Explains things.
      </HelpTip>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'What does this mean?' }));
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Maps' })).toHaveAttribute(
      'href',
      '/app/maps?trait=t1',
    );
    withLink.unmount();

    render(<HelpTip>Explains things.</HelpTip>);
    fireEvent.click(screen.getByRole('button', { name: 'What does this mean?' }));
    expect(screen.queryByRole('link', { name: 'Maps' })).not.toBeInTheDocument();
  });

  it('shows a larger trigger — a 28px button around a 20px icon — keeping its focus ring', () => {
    render(<HelpTip>Explains things.</HelpTip>);
    const button = screen.getByRole('button', { name: 'What does this mean?' });
    expect(button).toHaveClass(
      'size-7',
      'focus-visible:outline-2',
      'focus-visible:outline-pollen-500',
    );
    expect(button).not.toHaveClass('size-5');
    expect(button.querySelector('svg')).toHaveAttribute('width', '20');
  });
});
