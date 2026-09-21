import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeEmblem } from './TreeEmblem.tsx';

function stubMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: reduced }));
}

beforeEach(() => {
  stubMotion(false);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 100,
    left: 100,
    top: 100,
    right: 356,
    bottom: 356,
    width: 256,
    height: 256,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RFC-13 R7 TreeEmblem', () => {
  it('is an image with a name, and exposes its stage through the ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<TreeEmblem ref={ref} />);
    expect(screen.getByRole('img', { name: /TreeRepro/ })).toBeInTheDocument();
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('leans toward the pointer and settles back when it leaves', () => {
    const ref = createRef<HTMLDivElement>();
    render(<TreeEmblem ref={ref} />);
    const stage = ref.current as HTMLDivElement;
    fireEvent.mouseMove(document, { clientX: 356, clientY: 100 }); // top-right of the stage
    expect(stage.style.transform).toMatch(/rotateY\(4(\.\d+)?deg\)/);
    expect(stage.style.transform).toMatch(/rotateX\(4(\.\d+)?deg\)/);
    fireEvent.mouseLeave(document);
    expect(stage.style.transform).toMatch(/rotateY\(0deg\) rotateX\(0deg\)/);
  });

  it('stays still under prefers-reduced-motion', () => {
    stubMotion(true);
    const ref = createRef<HTMLDivElement>();
    render(<TreeEmblem ref={ref} />);
    fireEvent.mouseMove(document, { clientX: 356, clientY: 100 });
    expect((ref.current as HTMLDivElement).style.transform).toBe('');
  });

  it('names its stage for the view transition and keeps the rings and the glow in wrappers the reveal can move', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<TreeEmblem ref={ref} />);
    expect(ref.current).toHaveClass('[view-transition-name:tr-emblem]');
    expect(container.querySelectorAll('.tr-rings > .tr-ring')).toHaveLength(3);
    expect(container.querySelector('.tr-glow-wrap > .tr-glow')).not.toBeNull();
  });
});
