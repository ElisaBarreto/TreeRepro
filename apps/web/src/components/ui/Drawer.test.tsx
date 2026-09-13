import { fireEvent, render, screen } from '@testing-library/react';
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
