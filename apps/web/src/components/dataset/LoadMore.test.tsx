import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadMore } from './LoadMore.tsx';

// A minimal stand-in for the browser API: the constructor records the
// callback it was given and `observe` fires it immediately with an
// intersecting entry, the same way a sentinel already on screen behaves.
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
    void target;
  }

  disconnect() {}
  unobserve() {}
}

let originalIntersectionObserver: typeof IntersectionObserver | undefined;

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  if (originalIntersectionObserver) globalThis.IntersectionObserver = originalIntersectionObserver;
});

describe('RFC-11 R6 LoadMore', () => {
  it('calls onLoadMore once when the sentinel is observed and not paused', () => {
    const onLoadMore = vi.fn();
    render(<LoadMore hasMore isLoadingMore={false} onLoadMore={onLoadMore} />);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('never observes, and never calls onLoadMore, while paused', () => {
    const onLoadMore = vi.fn();
    render(<LoadMore hasMore isLoadingMore={false} onLoadMore={onLoadMore} paused />);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not re-arm while paused, even as other props keep changing', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <LoadMore hasMore isLoadingMore={false} onLoadMore={onLoadMore} paused />,
    );
    rerender(<LoadMore hasMore isLoadingMore onLoadMore={onLoadMore} paused />);
    rerender(<LoadMore hasMore isLoadingMore={false} onLoadMore={onLoadMore} paused />);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
