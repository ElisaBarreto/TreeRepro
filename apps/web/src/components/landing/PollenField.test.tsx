import { render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollenField } from './PollenField.tsx';

function fakeContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
  };
}

const raf = vi.fn<typeof requestAnimationFrame>();
const caf = vi.fn<typeof cancelAnimationFrame>();
let ctx: ReturnType<typeof fakeContext>;

function stubMotion(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: reduced, addEventListener: vi.fn() }),
  );
}

beforeEach(() => {
  ctx = fakeContext();
  raf.mockReset().mockReturnValue(1);
  caf.mockReset();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  stubMotion(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RFC-10 R3 PollenField', () => {
  it('renders a decorative canvas that never takes the pointer', () => {
    const { container } = render(<PollenField count={10} emitterRef={createRef()} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas?.className).toContain('pointer-events-none');
  });

  it('starts the animation loop and paints grains on each frame', () => {
    render(<PollenField count={10} emitterRef={createRef()} />);
    expect(raf).toHaveBeenCalledTimes(1);
    const frame = raf.mock.calls[0]?.[0] as FrameRequestCallback;
    frame(16);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it('paints one still frame under prefers-reduced-motion', () => {
    stubMotion(true);
    render(<PollenField count={10} emitterRef={createRef()} />);
    expect(raf).not.toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('stops the loop on unmount', () => {
    const { unmount } = render(<PollenField count={10} emitterRef={createRef()} />);
    unmount();
    expect(caf).toHaveBeenCalledWith(1);
  });
});
