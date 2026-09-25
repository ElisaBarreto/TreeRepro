import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './index.ts';

describe('RFC-13 R5 Drawer', () => {
  it('opens as a labelled modal dialog with focus on its Close button', () => {
    render(
      <Drawer open title="Sexual system" onClose={() => {}}>
        <p>Body</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Sexual system' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(dialog).not.toHaveAttribute('style');
  });

  it('renders nothing while closed', () => {
    render(
      <Drawer open={false} title="Sexual system" onClose={() => {}}>
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('closes once through the Close button', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Sexual system" onClose={onClose}>
        <p>Body</p>
      </Drawer>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes once on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Sexual system" onClose={onClose}>
        <p>Body</p>
      </Drawer>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Sexual system" onClose={onClose}>
        <p>Body</p>
      </Drawer>,
    );
    await userEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the element that opened it once it closes', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Drawer open={open} title="Sexual system" onClose={() => setOpen(false)}>
            <p>Body</p>
          </Drawer>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('only the drawer holding focus reacts to Escape when two are open', async () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      <>
        <Drawer open title="Outer" onClose={closeOuter}>
          <p>Outer body</p>
        </Drawer>
        <Drawer open title="Inner" onClose={closeInner}>
          <p>Inner body</p>
        </Drawer>
      </>,
    );
    await userEvent.keyboard('{Escape}');
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });
});

describe('RFC-13 R10 Drawer is modal', () => {
  it('renders at the end of document.body and marks its siblings inert while open', async () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <>
        <button type="button">outside</button>
        <Drawer open title="Modal" onClose={onClose}>
          <button type="button">inside</button>
        </Drawer>
      </>,
    );
    const outside = screen.getByRole('button', { name: 'outside' });
    expect(outside.closest('[inert]')).not.toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Modal' });
    expect(dialog.closest('[inert]')).toBeNull();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    rerender(
      <>
        <button type="button">outside</button>
        <Drawer open={false} title="Modal" onClose={onClose}>
          <button type="button">inside</button>
        </Drawer>
      </>,
    );
    expect(outside.closest('[inert]')).toBeNull();
    expect(container).toBeInTheDocument();
  });

  it('cycles Tab inside the panel', async () => {
    render(
      <Drawer open title="Modal" onClose={() => undefined}>
        <button type="button">first</button>
        <button type="button">last</button>
      </Drawer>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(first).toHaveFocus();
    await userEvent.tab();
    expect(last).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('makes the outer drawer inert while an inner one opens later, and active again with its Close focused once the inner closes', () => {
    const { rerender } = render(
      <>
        <Drawer open title="Outer" onClose={() => undefined}>
          <p>Outer body</p>
        </Drawer>
        <Drawer open={false} title="Inner" onClose={() => undefined}>
          <p>Inner body</p>
        </Drawer>
      </>,
    );
    const outer = screen.getByRole('dialog', { name: 'Outer' });
    const outerClose = within(outer).getByRole('button', { name: 'Close' });
    expect(outer.closest('[inert]')).toBeNull();
    expect(outerClose).toHaveFocus();
    rerender(
      <>
        <Drawer open title="Outer" onClose={() => undefined}>
          <p>Outer body</p>
        </Drawer>
        <Drawer open title="Inner" onClose={() => undefined}>
          <p>Inner body</p>
        </Drawer>
      </>,
    );
    const inner = screen.getByRole('dialog', { name: 'Inner' });
    expect(outer.closest('[inert]')).not.toBeNull();
    expect(inner.closest('[inert]')).toBeNull();
    expect(within(inner).getByRole('button', { name: 'Close' })).toHaveFocus();
    rerender(
      <>
        <Drawer open title="Outer" onClose={() => undefined}>
          <p>Outer body</p>
        </Drawer>
        <Drawer open={false} title="Inner" onClose={() => undefined}>
          <p>Inner body</p>
        </Drawer>
      </>,
    );
    expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument();
    expect(outer.closest('[inert]')).toBeNull();
    expect(outerClose).toHaveFocus();
  });

  it('keeps the later-mounted drawer active when two open in the same commit', () => {
    const { rerender } = render(
      <>
        <Drawer open title="Outer" onClose={() => undefined}>
          <p>Outer body</p>
        </Drawer>
        <Drawer open title="Inner" onClose={() => undefined}>
          <p>Inner body</p>
        </Drawer>
      </>,
    );
    const outer = screen.getByRole('dialog', { name: 'Outer' });
    const inner = screen.getByRole('dialog', { name: 'Inner' });
    expect(outer.closest('[inert]')).not.toBeNull();
    expect(inner.closest('[inert]')).toBeNull();
    rerender(
      <>
        <Drawer open title="Outer" onClose={() => undefined}>
          <p>Outer body</p>
        </Drawer>
        <Drawer open={false} title="Inner" onClose={() => undefined}>
          <p>Inner body</p>
        </Drawer>
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'Outer' }).closest('[inert]')).toBeNull();
  });

  it('closing the outer drawer first keeps the inner modal', () => {
    const page = (outer: boolean, inner: boolean) => (
      <>
        <button type="button">Open</button>
        <Drawer open={outer} title="Outer" onClose={() => undefined}>
          <p>Outer body</p>
        </Drawer>
        <Drawer open={inner} title="Inner" onClose={() => undefined}>
          <p>Inner body</p>
        </Drawer>
      </>
    );
    const { rerender } = render(page(false, false));
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    rerender(page(true, true));
    expect(opener.closest('[inert]')).not.toBeNull();
    // The outer closes on its own (the page dropped it) while the inner is
    // still open: the inner must stay the modal one.
    rerender(page(false, true));
    expect(screen.queryByRole('dialog', { name: 'Outer' })).not.toBeInTheDocument();
    const inner = screen.getByRole('dialog', { name: 'Inner' });
    expect(inner.closest('[inert]')).toBeNull();
    expect(opener.closest('[inert]')).not.toBeNull();
    expect(within(inner).getByRole('button', { name: 'Close' })).toHaveFocus();
    rerender(page(false, false));
    expect(document.querySelector('[inert]')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('RFC-13 R12 Drawer side', () => {
  it('opens from the right by default and from the left with side="left"', () => {
    const { rerender } = render(
      <Drawer open title="Panel" onClose={() => {}}>
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Panel' }).parentElement).toHaveClass('justify-end');
    rerender(
      <Drawer open title="Panel" side="left" onClose={() => {}}>
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Panel' }).parentElement).toHaveClass(
      'justify-start',
    );
  });
});
