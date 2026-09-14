import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.tsx';
import { pushModal } from './modal-stack.ts';

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
 * while open (RFC-13 R10). The open modals — drawers and dialogs alike —
 * are kept in the shared stack of `modal-stack.ts`: the topmost is the only
 * active child of `body`, every other child is `inert` (those that already
 * had the attribute keep it), whichever modal opens or closes and in
 * whatever order. Focus moves to the Close button on open; on close the
 * stack returns it to the modal left on top, or to the opener once none
 * remains. Tab and Shift+Tab cycle among the panel's focusable elements;
 * Escape and a backdrop click close it. Renders nothing while closed.
 * @rfc RFC-13 R5, R7, R10
 */
export function Drawer({ open, title, onClose, size = 'md', children }: DrawerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    // Registered before focus moves, so the element focused now is the opener.
    const pop = pushModal(root);
    closeRef.current?.focus();
    return pop;
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
