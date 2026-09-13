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

interface OpenDrawer {
  root: HTMLElement;
  /** Where focus returns once this drawer (or the last one standing) closes. */
  opener: HTMLElement | null;
}

/**
 * Every open drawer's portal root, in mount order: the last one is the
 * active drawer. Shared by all instances so that one drawer closing — in
 * whatever order — leaves exactly the topmost remaining drawer active and
 * everything else `inert`.
 */
const openDrawers: OpenDrawer[] = [];
/** Body children this module set `inert` on; only those are ever unmarked. */
const marked = new WeakSet<Element>();

/** Topmost open drawer active, every other child of `body` inert. */
function recompute() {
  const top = openDrawers[openDrawers.length - 1]?.root;
  for (const child of Array.from(document.body.children)) {
    if (child === top) {
      if (marked.delete(child)) child.removeAttribute('inert');
    } else if (!child.hasAttribute('inert')) {
      child.setAttribute('inert', '');
      marked.add(child);
    }
  }
}

function clearMarks() {
  for (const child of Array.from(document.body.children)) {
    if (marked.delete(child)) child.removeAttribute('inert');
  }
}

/**
 * Right-side panel over a dimmed backdrop, rendered through a portal at the
 * end of `document.body` so it can make the rest of the document `inert`
 * while open (RFC-13 R10). The open drawers are kept in a module-level
 * stack: the topmost is the only active child of `body`, every other child
 * is `inert` (those that already had the attribute keep it), whichever
 * drawer opens or closes and in whatever order. Focus moves to the Close
 * button on open; on close it goes to the Close button of the drawer left
 * on top, or back to the opener once no drawer remains. Tab and Shift+Tab
 * cycle among the panel's focusable elements; Escape and a backdrop click
 * close it. Renders nothing while closed.
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
    const entry: OpenDrawer = {
      root,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    // Two drawers mounting in the same commit push in effect order, so the
    // later-mounted one ends up on top.
    openDrawers.push(entry);
    recompute();
    closeRef.current?.focus();
    return () => {
      const index = openDrawers.indexOf(entry);
      if (index !== -1) openDrawers.splice(index, 1);
      const remaining = openDrawers[openDrawers.length - 1];
      if (!remaining) {
        clearMarks();
        if (entry.opener?.isConnected) entry.opener.focus();
        return;
      }
      // A drawer opened from inside this one captured a focus target that
      // leaves the document with this root; hand it this drawer's own, so
      // the last drawer to close still returns focus to the page.
      for (const other of openDrawers) {
        if (!other.opener?.isConnected || root.contains(other.opener)) other.opener = entry.opener;
      }
      recompute();
      remaining.root.querySelector<HTMLElement>('[aria-label="Close"]')?.focus();
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
