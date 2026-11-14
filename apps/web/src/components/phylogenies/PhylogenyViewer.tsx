import type { PhylogenyFigure } from '@treerepro/contracts';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { figureUrl } from '../../api/phylogenies.ts';

/** One figure as the viewer shows it, under the page's heading for it. @rfc RFC-79 R6 */
export interface PhylogenyViewerItem {
  figure: PhylogenyFigure;
  heading: string;
}

const CONTROL =
  'rounded-full px-3 py-1.5 text-label font-semibold text-canopy-900 transition-colors hover:bg-mist-50 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';

const MAX_SCALE = 4;
const STEP = 1.5;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(1, s));
// Wheel events closer than this in one direction are one gesture: one step.
const GESTURE_GAP_MS = 200;

/**
 * The full-size phylogeny viewer, a native `<dialog>` open while `index` names
 * one of `items`. It shows the display copy at once and swaps in the full PNG
 * once loaded (keeping the display copy if it fails). Zoom 1× to 4× by ×1.5
 * steps — wheel (a trackpad pinch arrives as one), two-finger pinch, + / −
 * buttons or keys, 0 to reset — and drag to pan while zoomed. Left/Right step
 * between items, wrapping; a new item starts at 1×. Escape closes it.
 * @rfc RFC-79 R6
 */
export function PhylogenyViewer({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: readonly PhylogenyViewerItem[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const item = index === null ? undefined : items[index];
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [full, setFull] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  // The latest scale, for the native wheel listener and pinch moves that
  // arrive between renders.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const key = item?.figure.key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new figure starts at 1×, unloaded.
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    pointers.current.clear();
    pinch.current = null;
    setFull('loading');
  }, [key]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
    if (!item && dialog.open) dialog.close();
  }, [item]);

  // A native, non-passive listener: React's `onWheel` is passive, so it could
  // not stop the page scrolling or a trackpad pinch zooming the browser. One
  // gesture (a trackpad sends dozens of events) is one ×1.5 step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attached for each figure's <img>.
  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;
    let last = { at: Number.NEGATIVE_INFINITY, dir: 0 };
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const dir = Math.sign(event.deltaY);
      if (dir === 0) return;
      const sameGesture = dir === last.dir && event.timeStamp - last.at < GESTURE_GAP_MS;
      last = { at: event.timeStamp, dir };
      if (!sameGesture) zoomTo(dir < 0 ? scaleRef.current * STEP : scaleRef.current / STEP);
    }
    img.addEventListener('wheel', onWheel, { passive: false });
    return () => img.removeEventListener('wheel', onWheel);
  }, [key]);

  function zoomTo(next: number) {
    const s = clampScale(next);
    scaleRef.current = s;
    setScale(s);
    if (s === 1) setOffset({ x: 0, y: 0 });
  }

  function step(delta: number) {
    if (index === null) return;
    onIndexChange((index + delta + items.length) % items.length);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) zoomTo(scaleRef.current * (distance / pinch.current));
      pinch.current = distance;
      return;
    }
    if (scale === 1) return;
    setOffset((o) => ({
      x: o.x + event.clientX - previous.x,
      y: o.y + event.clientY - previous.y,
    }));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
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
        else if (event.key === '+' || event.key === '=') zoomTo(scale * STEP);
        else if (event.key === '-') zoomTo(scale / STEP);
        else if (event.key === '0') zoomTo(1);
        else return;
        event.preventDefault();
      }}
      className="m-auto h-[calc(100dvh-2rem)] w-[min(94vw,1400px)] flex-col gap-3 overflow-hidden rounded-2xl border border-canopy-700/20 bg-white p-4 outline-none open:flex backdrop:bg-canopy-950/60"
    >
      {item && index !== null ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-section font-semibold text-canopy-950">
              {item.heading}
            </h2>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                aria-label="Zoom out"
                className={CONTROL}
                disabled={scale === 1}
                onClick={() => zoomTo(scale / STEP)}
              >
                −
              </button>
              <span className="w-12 text-center text-meta text-mist-500">
                {`${Math.round(scale * 100)}%`}
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                className={CONTROL}
                disabled={scale === MAX_SCALE}
                onClick={() => zoomTo(scale * STEP)}
              >
                +
              </button>
              {items.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Previous figure"
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
                    aria-label="Next figure"
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
          <div
            className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-lg bg-mist-50"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              src={figureUrl(item.figure, full === 'loaded' ? 'full' : 'display')}
              alt={`Phylogeny: ${item.heading}`}
              draggable={false}
              ref={imageRef}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              }}
              className={`h-full w-full touch-none select-none object-contain ${scale > 1 ? 'cursor-grab' : ''}`}
            />
            {full === 'loading' ? (
              <img
                data-preload
                src={figureUrl(item.figure, 'full')}
                alt=""
                hidden
                onLoad={() => setFull('loaded')}
                onError={() => setFull('failed')}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </dialog>
  );
}
