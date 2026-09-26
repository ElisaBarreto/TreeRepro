import type { MapEntry } from '@treerepro/contracts';
import { type ReactNode, useRef } from 'react';
import { mapFileUrl } from '../../api/maps.ts';

/**
 * One map image inside a fixed-ratio frame (RFC-76 R7): `size="thumb"` is
 * the image alone — a catalog card's own link handles the click — and
 * `size="full"` (the default) wraps it in a button that opens the same
 * image full width in a native `<dialog>` (`showModal`), the way the trait
 * detail page and its cards use this same component. The legend lives
 * inside the image itself (RFC-76 R3); the platform draws none of its own.
 * @rfc RFC-76 R6
 * @rfc RFC-76 R7
 */
export function MapFigure({
  entry,
  alt,
  caption,
  size = 'full',
}: {
  entry: MapEntry;
  alt: string;
  caption?: ReactNode;
  size?: 'thumb' | 'full';
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const src = mapFileUrl(entry.file);
  const frame =
    'flex aspect-[2/1] items-center justify-center overflow-hidden rounded-lg bg-mist-50';
  const image = <img src={src} alt={alt} loading="lazy" className="size-full object-contain" />;

  return (
    <figure className="flex flex-col gap-2">
      {size === 'thumb' ? (
        <div className={frame}>{image}</div>
      ) : (
        <button
          type="button"
          className={`${frame} w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500`}
          onClick={() => dialogRef.current?.showModal()}
        >
          {image}
        </button>
      )}
      {caption ? <figcaption className="text-meta text-mist-500">{caption}</figcaption> : null}
      {size === 'full' ? (
        <dialog
          ref={dialogRef}
          aria-label={alt}
          className="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,960px)] flex-col gap-3 overflow-hidden rounded-2xl border border-canopy-700/20 bg-white p-4 open:flex backdrop:bg-canopy-950/60"
        >
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-full px-3 py-1.5 text-label font-semibold text-canopy-900 transition-colors hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
            >
              Close
            </button>
          </div>
          <img src={src} alt={alt} loading="lazy" className="w-full object-contain" />
        </dialog>
      ) : null}
    </figure>
  );
}
