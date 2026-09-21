import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVEAL, runReveal, travelOffset } from './reveal.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RFC-13 R7 sign-in reveal beats', () => {
  it('recedes now, grows at 350 ms and leaves at 1550 ms', () => {
    const onPhase = vi.fn();
    const onLeave = vi.fn();
    runReveal({ onPhase, onLeave });
    expect(onPhase).toHaveBeenCalledWith('recede');
    expect(onLeave).not.toHaveBeenCalled();

    vi.advanceTimersByTime(REVEAL.grow - 1);
    expect(onPhase).not.toHaveBeenCalledWith('grow');
    vi.advanceTimersByTime(1);
    expect(onPhase).toHaveBeenLastCalledWith('grow');
    expect(onLeave).not.toHaveBeenCalled();

    vi.advanceTimersByTime(REVEAL.leave - REVEAL.grow);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('cancelling stops the beats still to come', () => {
    const onPhase = vi.fn();
    const onLeave = vi.fn();
    const cancel = runReveal({ onPhase, onLeave });
    cancel();
    vi.advanceTimersByTime(REVEAL.leave + 1);
    expect(onPhase).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });
});

describe('RFC-13 R7 travel offset', () => {
  it('is the vector from the stage centre to the viewport centre', () => {
    const stage = { left: 100, top: 200, width: 256, height: 256 };
    expect(travelOffset(stage, { width: 1280, height: 800 })).toEqual({ dx: 412, dy: 72 });
  });

  it('is zero for a stage already centred', () => {
    const stage = { left: 512, top: 272, width: 256, height: 256 };
    expect(travelOffset(stage, { width: 1280, height: 800 })).toEqual({ dx: 0, dy: 0 });
  });
});
