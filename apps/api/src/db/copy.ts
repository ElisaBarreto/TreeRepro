import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** How long a COPY may go without the writable accepting a new chunk before it's considered stuck; callers expose it so tests can fail fast. @rfc RFC-64 R9 */
export const DEFAULT_COPY_IDLE_TIMEOUT_MS = 60_000;

/**
 * Streams `source` into `destination`, aborting once `destination` has gone
 * `idleTimeoutMs` without accepting a chunk — not once the whole transfer
 * has taken too long, since a real dataset file is millions of rows and the
 * COPY itself can legitimately run for minutes.
 *
 * This guards against a real hang in postgres.js 3.4.9's `.writable()` COPY
 * stream (verified directly against the driver, outside Drizzle): `.writable()`
 * runs COPY over the simple query protocol. On a row that violates the COPY
 * format, the server answers `ErrorResponse` + `ReadyForQuery`, but the
 * client only resolves the write from its `CommandComplete` handler, which
 * is also the sole place that invokes the `final()` callback stored when we
 * call `.end()` (which sends `CopyDone`). `CommandComplete` never arrives on
 * the error path, so if `.end()` is called before the driver has processed
 * the server's error, the writable neither errors nor finishes — the pipeline
 * hangs forever, silently, with no event ever firing on either stream. A
 * `PassThrough` sits between `source` and `destination` purely so we can
 * observe every chunk that reaches the destination side and re-arm the idle
 * timer; once nothing has moved for `idleTimeoutMs` we abort, which reliably
 * unblocks the driver (a `.destroy()`, sending `CopyFail`) even when the
 * error path above is stuck. Every COPY in the code base (the importer, the
 * dictionary seed) goes through here — never `pipeline()` straight into
 * `.writable()` (docs/gotchas/import.md).
 * @rfc RFC-64 R9
 */
export async function pipelineWithIdleGuard(
  source: NodeJS.ReadableStream,
  destination: NodeJS.WritableStream,
  idleTimeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const watcher = new PassThrough();
  let timer = setTimeout(() => controller.abort(), idleTimeoutMs);
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  watcher.on('data', arm);
  try {
    await pipeline(source, watcher, destination, { signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(
        `COPY made no progress for ${idleTimeoutMs}ms; the file likely has a row that violates the column count or format`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    watcher.off('data', arm);
  }
}
