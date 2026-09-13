import { type ReactNode, useEffect, useId, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Native `<dialog>` opened with `showModal`, so focus trapping and Escape are
 * the browser's. `onClose` fires for the button, Escape and backdrop clicks.
 * @rfc RFC-13 R5
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: closes on a backdrop click as a pointer convenience only; Escape (native <dialog> behavior) and the Close button already close this by keyboard
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-[min(92vw,480px)] rounded-2xl border border-canopy-700/20 bg-white p-0 text-canopy-950 shadow-xl backdrop:bg-canopy-950/60"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops the click from bubbling to the backdrop handler above; it triggers no action of its own */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same as above — nothing to trigger by keyboard */}
      <div className="flex flex-col gap-5 p-6" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full px-2 text-mist-500 transition-colors hover:text-canopy-900"
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
