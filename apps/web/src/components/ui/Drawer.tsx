import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** `md` fits a detail view; `lg` fits a table. */
  size?: 'md' | 'lg';
  children: ReactNode;
}

const SIZES: Record<NonNullable<DrawerProps['size']>, string> = {
  md: 'max-w-xl',
  lg: 'max-w-4xl',
};

/**
 * Right-side panel over a dimmed backdrop, built from plain elements rather
 * than `<dialog>` so it renders the same everywhere (jsdom included). While
 * open it is the labelled modal dialog of the page: focus moves to its Close
 * button on open and returns to the element that had it when it closes;
 * Escape and a backdrop click close it, a click inside does not. Escape is
 * handled on the panel itself, not on the document, so with two drawers open
 * only the one holding focus closes. Renders nothing while closed.
 * @rfc RFC-13 R5, R7
 */
export function Drawer({ open, title, onClose, size = 'md', children }: DrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes on a pointer click as a convenience; Escape and the Close button are the keyboard paths
    // biome-ignore lint/a11y/useKeyWithClickEvents: same — the keyboard handler lives on the panel, which holds focus
    <div
      className="fixed inset-0 z-40 flex justify-end bg-canopy-950/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className={`flex h-full w-full flex-col bg-white text-canopy-950 shadow-xl ${SIZES[size]}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-canopy-700/10 px-6 py-4">
          <h2 id={titleId} className="font-display text-lg font-bold">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full px-2 text-mist-500 transition-colors hover:text-canopy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </section>
    </div>
  );
}
