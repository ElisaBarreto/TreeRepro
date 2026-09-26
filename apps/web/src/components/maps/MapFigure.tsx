import type { MapEntry } from '@treerepro/contracts';
import type { ReactNode } from 'react';
import { mapFileUrl } from '../../api/maps.ts';

/**
 * One map image inside a fixed-ratio frame (RFC-76 R7), lazily loaded. With
 * `onOpen` the image is a button that asks the page to show it full size —
 * the page owns the one viewer (`MapViewer`) so it can step through all of a
 * trait's maps; without it the image stands alone (the trait page's
 * thumbnail). The legend lives inside the image itself (RFC-76 R3); the
 * platform draws none of its own.
 * @rfc RFC-76 R7, R8
 */
export function MapFigure({
  entry,
  alt,
  caption,
  onOpen,
}: {
  entry: MapEntry;
  alt: string;
  caption?: ReactNode;
  onOpen?: () => void;
}) {
  const frame =
    'flex aspect-[2/1] items-center justify-center overflow-hidden rounded-lg bg-mist-50';
  const image = (
    <img
      src={mapFileUrl(entry.file)}
      alt={alt}
      loading="lazy"
      className="size-full object-contain"
    />
  );

  return (
    <figure className="flex flex-col gap-2">
      {onOpen ? (
        <button
          type="button"
          className={`${frame} w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500`}
          onClick={onOpen}
        >
          {image}
        </button>
      ) : (
        <div className={frame}>{image}</div>
      )}
      {caption ? <figcaption className="text-meta text-mist-500">{caption}</figcaption> : null}
    </figure>
  );
}
