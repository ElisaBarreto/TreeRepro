import {
  type QueryClient,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { invalidateAfterRecordWrite } from '../api/curation.ts';

export interface RecordWriteOptions<TVariables, TResult> {
  write: (variables: TVariables) => Promise<TResult>;
  /** The species the write touches; absent for a bulk mapping, which touches every species. */
  speciesId?: string;
  /** Runs with the answer before the invalidation: seed a query with it, reset a form. */
  onWritten?: (result: TResult, queryClient: QueryClient) => void;
  /** Runs once every stale list, detail, queue and summary is invalidated: close the dialog, hand the answer up. */
  onInvalidated?: (result: TResult) => void;
}

/**
 * The one mutation shape of the record writes (create, annotate, map): the
 * write, then the invalidation every record write owes
 * (`invalidateAfterRecordWrite` — every `['records', …]` and the species'
 * `['species', id, …]`, which already cover the pending queues), with a
 * hook before it for what the caller seeds from the answer and one after it
 * for what happens once the screen is consistent again. `isPending` stays
 * true through both, so a dialog keeps its Cancel disabled until it
 * unmounts.
 * @rfc RFC-13 R6
 * @rfc RFC-65 R1, R3, R9
 */
export function useRecordWrite<TVariables = void, TResult = unknown>({
  write,
  speciesId,
  onWritten,
  onInvalidated,
}: RecordWriteOptions<TVariables, TResult>): UseMutationResult<TResult, Error, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    // Not `mutationFn: write`: TanStack passes a context as a second argument,
    // which would reach an API function that takes only the body.
    mutationFn: (variables) => write(variables),
    onSuccess: async (result) => {
      onWritten?.(result, queryClient);
      await invalidateAfterRecordWrite(queryClient, speciesId);
      onInvalidated?.(result);
    },
  });
}
