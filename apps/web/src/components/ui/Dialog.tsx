import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Icon } from './Icon.tsx';

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
 * `closeDisabled` means the dialog cannot be dismissed at all while it is
 * set, not just that the Close button is inert: a backdrop click is ignored,
 * Escape's `cancel` event is prevented (browsers that honour that keep the
 * dialog open), and if the browser closes it anyway — some close-watcher
 * implementations close before `cancel` can be prevented — the native
 * `close` handler reopens it immediately and swallows the event instead of
 * calling `onClose`.
 * @rfc RFC-13 R5
 */
export function Dialog({ open, title, onClose, closeDisabled, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
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
      className="m-auto w-[min(92vw,480px)] rounded-2xl border border-canopy-700/20 bg-white p-0 text-canopy-950 shadow-xl backdrop:bg-canopy-950/60"
    >
      <div className="flex flex-col gap-5 p-6">
        <header className="flex items-start justify-between gap-4">
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
        {children}
      </div>
    </dialog>
  );
}
