import type { MapEntry } from '@treerepro/contracts';
import { useEffect, useRef } from 'react';
import { mapFileUrl } from '../../api/maps.ts';

/** One map as the viewer shows it: the page's heading for it and its alt text. @rfc RFC-76 R7 */
export interface MapViewerItem {
  entry: MapEntry;
  heading: string;
  alt: string;
}

const CONTROL =
  'rounded-full px-3 py-1.5 text-label font-semibold text-canopy-900 transition-colors hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';

/**
 * The page's one full-size map viewer, a native `<dialog>` (`showModal`):
 * open while `index` names one of `items` — the selected trait's maps in
 * page order — closed while it is `null`. Left/Right (or the ← / → buttons)
 * step to the previous/next map, wrapping; Escape closes it natively. It
 * heads the map with the same text the page does and repeats its alt text
 * for sighted users, `aria-hidden` so a screen reader — already given that
 * text as the image's own alt — does not hear it twice.
 * @rfc RFC-76 R7
 */
export function MapViewer({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: readonly MapViewerItem[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const item = index === null ? undefined : items[index];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) {
      dialog.showModal();
      // The dialog itself takes focus, not its first button, so the arrow
      // keys work at once and Enter never steps back by surprise.
      dialog.focus();
    }
    if (!item && dialog.open) dialog.close();
  }, [item]);

  function step(delta: number) {
    if (index === null) return;
    onIndexChange((index + delta + items.length) % items.length);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={item?.heading}
      tabIndex={-1}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') step(1);
        else if (event.key === 'ArrowLeft') step(-1);
        else return;
        event.preventDefault();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,1200px)] flex-col gap-3 overflow-hidden rounded-2xl border border-canopy-700/20 bg-white p-4 outline-none open:flex backdrop:bg-canopy-950/60"
    >
      {item && index !== null ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-section font-semibold text-canopy-950">
                {item.heading}
              </h2>
              <p aria-hidden="true" className="text-meta text-mist-500">
                {item.alt}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {items.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Previous map"
                    className={CONTROL}
                    onClick={() => step(-1)}
                  >
                    ←
                  </button>
                  <span className="text-meta text-mist-500">
                    {index + 1} of {items.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next map"
                    className={CONTROL}
                    onClick={() => step(1)}
                  >
                    →
                  </button>
                </>
              ) : null}
              <button type="button" onClick={() => dialogRef.current?.close()} className={CONTROL}>
                Close
              </button>
            </div>
          </div>
          <img
            src={mapFileUrl(item.entry.file)}
            alt={item.alt}
            className="min-h-0 w-full flex-1 object-contain"
          />
        </>
      ) : null}
    </dialog>
  );
}
