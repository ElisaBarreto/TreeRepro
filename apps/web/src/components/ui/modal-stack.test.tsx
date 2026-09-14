import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, Drawer } from './index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RFC-13 R10 modal stack (Dialog + Drawer)', () => {
  it('Dialog returns focus to the element that opened it when it unmounts without a close event', async () => {
    // A dialog that saves successfully is unmounted by its parent while still
    // open, so the browser never fires `close` and never restores focus itself.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open ? (
            <Dialog open title="Edit" onClose={() => setOpen(false)}>
              <button type="button" onClick={() => setOpen(false)}>
                Save
              </button>
            </Dialog>
          ) : null}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Dialog returns focus to its opener when the parent sets open=false', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog open={open} title="Edit" onClose={() => setOpen(false)}>
            <button type="button" onClick={() => setOpen(false)}>
              Save
            </button>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(opener).toHaveFocus();
  });

  it('a Dialog opened from inside a Drawer makes the drawer inert and hands focus back to the drawer button that opened it', async () => {
    function Harness() {
      const [drawer, setDrawer] = useState(false);
      const [dialog, setDialog] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setDrawer(true)}>
            Open drawer
          </button>
          <Drawer open={drawer} title="Record" onClose={() => setDrawer(false)}>
            <button type="button" onClick={() => setDialog(true)}>
              Open dialog
            </button>
          </Drawer>
          {dialog ? (
            <Dialog open title="Note" onClose={() => setDialog(false)}>
              <button type="button" onClick={() => setDialog(false)}>
                Done
              </button>
            </Dialog>
          ) : null}
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    const drawer = screen.getByRole('dialog', { name: 'Record' });
    const openDialog = within(drawer).getByRole('button', { name: 'Open dialog' });
    await userEvent.click(openDialog);
    const dialog = screen.getByRole('dialog', { name: 'Note' });
    expect(dialog.closest('[inert]')).toBeNull();
    expect(drawer.closest('[inert]')).not.toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Note' })).not.toBeInTheDocument();
    expect(drawer.closest('[inert]')).toBeNull();
    expect(openDialog).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open drawer' })).toHaveFocus();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('warns in development when a Drawer opens over an open Dialog, which the native modal would block', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <>
        <Dialog open title="Note" onClose={() => {}}>
          <p>Body</p>
        </Dialog>
        <Drawer open={false} title="Record" onClose={() => {}}>
          <p>Body</p>
        </Drawer>
      </>,
    );
    expect(error).not.toHaveBeenCalled();
    rerender(
      <>
        <Dialog open title="Note" onClose={() => {}}>
          <p>Body</p>
        </Dialog>
        <Drawer open title="Record" onClose={() => {}}>
          <p>Body</p>
        </Drawer>
      </>,
    );
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Drawer .* over .* Dialog/));
  });
});
