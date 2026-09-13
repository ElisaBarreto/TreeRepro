import { useEffect, useRef } from 'react';
import { Button } from '../ui/index.ts';

/**
 * Tail of a cursor list. A sentinel observed with `IntersectionObserver`
 * asks for the next page as it scrolls into view; the visible button does the
 * same for keyboards and for environments without the observer (jsdom).
 * Renders nothing once the list is complete.
 * @rfc RFC-11 R6
 */
export function LoadMore({
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  // The callback changes identity on every render of the caller; the observer
  // reads the latest one through the ref instead of being rebuilt each time.
  const latest = useRef(onLoadMore);
  useEffect(() => {
    latest.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || isLoadingMore || typeof IntersectionObserver === 'undefined') return;
    // Re-observing after each page fires the initial callback again, so a
    // sentinel still in view keeps loading until it is pushed off-screen.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore]);

  if (!hasMore) return null;
  return (
    <div ref={sentinel} className="flex justify-center py-4">
      <Button variant="secondary" pending={isLoadingMore} onClick={() => onLoadMore()}>
        Load more
      </Button>
    </div>
  );
}
