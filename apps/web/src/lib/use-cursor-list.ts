import { type QueryKey, useInfiniteQuery } from '@tanstack/react-query';
import type { Page } from '../api/dataset.ts';

/** Infinite list over an RFC-11 R6 cursor endpoint. @rfc RFC-11 R6 */
export function useCursorList<T>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: { enabled?: boolean } = {},
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
  });
  return {
    items: query.data?.pages.flatMap((p) => p.data) ?? [],
    hasMore: query.hasNextPage,
    loadMore: () => query.fetchNextPage(),
    isLoading: query.isPending,
    isLoadingMore: query.isFetchingNextPage,
    error: query.error,
  };
}
