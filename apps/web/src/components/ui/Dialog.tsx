import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.tsx';
import { pushModal } from './modal-stack.ts';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Disables the Close (×) button, e.g. while a mutation triggered from inside is pending. */
  closeDisabled?: boolean;
  children: ReactNode;
}

/**
 * Native `<dialog>` opened with `showModal`, so focus trapping and Escape are
 * the browser's. The native `close` event is the single source of truth for
 * `onClose`: the Close button and the backdrop click both call
 * `ref.current?.close()` rather than `onClose()` directly, so the `<dialog
 * onClose={onClose}>` handler is the only thing that ever invokes the prop —
 * each user action (button, backdrop, or Escape) closes exactly once.
 *
 * Rendered through a portal at the end of `document.body` and registered in
 * the modal stack of `modal-stack.ts` while open, alongside `Drawer`: a
 * dialog opened from inside a drawer marks the drawer `inert` (the drawer's
 * own mark on the page would otherwise cover the dialog too), and focus
 * returns to the element that opened the dialog whether it closed through
 * the native `close` event or was unmounted still open — a parent unmounting
 * it on a successful save, where the browser restores nothing (RFC-13 R10).
 *
 * `closeDisabled` means the dialog cannot be dismissed at all while it is
 * set, not just that the Close button is inert: a backdrop click is ignored,
 * Escape's `cancel` event is prevented (browsers that honour that keep the
 * dialog open), and if the browser closes it anyway — some close-watcher
 * implementations close before `cancel` can be prevented — the native
 * `close` handler reopens it immediately and swallows the event instead of
 * calling `onClose`.
 * @rfc RFC-13 R5, R10
 */
export function Dialog({ open, title, onClose, closeDisabled, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Registered before `showModal` moves focus, so the element focused now is
  // the opener; the returned pop runs on close (`open` false) and on unmount.
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    return pushModal(dialog);
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: closes on a backdrop click as a pointer-only convenience; Escape and the Close button are the keyboard paths
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (closeDisabled) {
          ref.current?.showModal();
          return;
        }
        onClose();
      }}
      onCancel={(event) => {
        if (closeDisabled) event.preventDefault();
      }}
      onClick={(event) => {
        if (closeDisabled) return;
        if (event.target === ref.current) ref.current?.close();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,480px)] flex-col overflow-hidden rounded-2xl border border-canopy-700/20 bg-white p-0 text-canopy-950 shadow-xl backdrop:bg-canopy-950/60 open:flex"
    >
      {/* Only the body scrolls: Close stays in reach, and the scrollbar sits
          inside the rounded corners instead of squaring them off. */}
      <header className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
        <h2 id={titleId} className="font-display text-section font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
          disabled={closeDisabled}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-mist-500 transition-colors hover:bg-mist-50 hover:text-canopy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 pt-1 pb-6 [scrollbar-width:thin]">
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
