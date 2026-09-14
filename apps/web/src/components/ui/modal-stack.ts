interface OpenModal {
  /** The modal's own child of `document.body`: the `<dialog>`, or a drawer's portal root. */
  root: HTMLElement;
  /** Where focus returns once this modal (or the last one standing) closes. */
  opener: HTMLElement | null;
}

/**
 * Every open modal's root, in mount order: the last one is the active modal.
 * Shared by `Dialog` and `Drawer` so that one closing — in whatever order —
 * leaves exactly the topmost remaining modal active and everything else
 * `inert`, and so that focus has one bookkeeping to return through.
 */
const openModals: OpenModal[] = [];
/** Body children this module set `inert` on; only those are ever unmarked. */
const marked = new WeakSet<Element>();

/** Topmost open modal active, every other child of `body` inert. */
function recompute() {
  const top = openModals[openModals.length - 1]?.root;
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
 * Registers an opening modal and returns the function that unregisters it
 * on close or unmount. Call it from the open effect, before moving focus:
 * the element focused at that moment is the opener that focus returns to.
 *
 * On open, the new modal becomes the only active child of `body` (a native
 * `<dialog>` in the top layer also blocks the rest of the document itself).
 * On close, the modal left on top becomes active again and focus goes back
 * to this modal's opener when the opener lives inside that modal (a dialog
 * opened from a drawer), else to that modal's Close button; once no modal
 * remains every mark is lifted and focus returns to the opener on the page.
 * A modal opened from inside another captured a focus target that leaves
 * the document with the outer root, so an outer modal closing first hands
 * its own opener to the modals still open above it.
 *
 * A `Drawer` cannot open over an open `<dialog>`: the native modal blocks
 * everything outside its subtree, the drawer included, and no stack order
 * can lift that. Close the dialog first; in development the misuse is
 * reported once on open (docs/gotchas/web.md).
 * @rfc RFC-13 R10
 */
export function pushModal(root: HTMLElement): () => void {
  const top = openModals[openModals.length - 1]?.root;
  if (
    import.meta.env.DEV &&
    top instanceof HTMLDialogElement &&
    top.open &&
    !(root instanceof HTMLDialogElement)
  ) {
    // biome-ignore lint/suspicious/noConsole: development-only misuse report, the way React reports its own
    console.error(
      'A Drawer opened over an open Dialog: the native modal dialog blocks everything outside it, the drawer included. Close the dialog before opening the drawer.',
    );
  }
  const entry: OpenModal = {
    root,
    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  };
  // Two modals mounting in the same commit push in effect order, so the
  // later-mounted one ends up on top.
  openModals.push(entry);
  recompute();
  return () => {
    const index = openModals.indexOf(entry);
    if (index !== -1) openModals.splice(index, 1);
    const remaining = openModals[openModals.length - 1];
    if (!remaining) {
      clearMarks();
      if (entry.opener?.isConnected) entry.opener.focus();
      return;
    }
    for (const other of openModals) {
      if (!other.opener?.isConnected || root.contains(other.opener)) other.opener = entry.opener;
    }
    recompute();
    if (entry.opener?.isConnected && remaining.root.contains(entry.opener)) {
      entry.opener.focus();
    } else {
      remaining.root.querySelector<HTMLElement>('[aria-label="Close"]')?.focus();
    }
  };
}
