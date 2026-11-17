import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { pipelineWithIdleGuard } from './copy.ts';

describe('RFC-64 R9 pipelineWithIdleGuard', () => {
  it('aborts a COPY whose destination stops accepting chunks', async () => {
    // Never calls back: the destination stalls after its first chunk.
    const stalled = new Writable({ write: () => undefined });
    const started = Date.now();
    await expect(
      pipelineWithIdleGuard(Readable.from(['a\n', 'b\n', 'c\n']), stalled, 100),
    ).rejects.toThrow(/COPY made no progress for 100ms/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('lets a transfer that keeps moving finish', async () => {
    const received: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        received.push(String(chunk));
        cb();
      },
    });
    await pipelineWithIdleGuard(Readable.from(['a\n', 'b\n']), sink, 100);
    expect(received.join('')).toBe('a\nb\n');
  });

  it('keeps the destination error when it comes first', async () => {
    const failing = new Writable({
      write: (_chunk, _enc, cb) => cb(new Error('extra data after last expected column')),
    });
    await expect(pipelineWithIdleGuard(Readable.from(['a\n']), failing, 5000)).rejects.toThrow(
      /extra data after last expected column/,
    );
  });
});
