import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.tsx';

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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-side panel over a dimmed backdrop, rendered through a portal at the
 * end of `document.body` so it can make the rest of the document `inert`
 * while open (RFC-13 R10): every other child of `body` gets the attribute on
 * open and loses it on close (those that already had it keep it). Focus
 * moves to the Close button on open and returns to the opener on close; Tab
 * and Shift+Tab cycle among the panel's focusable elements; Escape and a
 * backdrop click close it. Renders nothing while closed.
 * @rfc RFC-13 R5, R7, R10
 */
export function Drawer({ open, title, onClose, size = 'md', children }: DrawerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const made: Element[] = [];
    for (const sibling of Array.from(document.body.children)) {
      if (sibling === rootRef.current || sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      made.push(sibling);
    }
    // Two drawers can mount in the same commit: both portal roots already sit
    // in document.body.children before either effect runs, so each one's
    // sibling scan can mark the other inert. The later-mounted drawer's
    // effect runs last, so clearing its own root here — after the scan —
    // leaves it the active one and keeps the earlier drawer inert beneath it.
    rootRef.current?.removeAttribute('inert');
    closeRef.current?.focus();
    return () => {
      for (const sibling of made) sibling.removeAttribute('inert');
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes on a pointer click as a convenience; Escape and the Close button are the keyboard paths
    // biome-ignore lint/a11y/useKeyWithClickEvents: same — the keyboard handler lives on the panel, which holds focus
    <div
      ref={rootRef}
      className="fixed inset-0 z-40 flex justify-end bg-canopy-950/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`flex h-full w-full flex-col bg-white text-canopy-950 shadow-xl ${SIZES[size]}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-canopy-700/10 px-6 py-5">
          <h2 id={titleId} className="font-display text-section font-semibold">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-mist-500 transition-colors hover:bg-mist-50 hover:text-canopy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
