import { type RefObject, useEffect, useRef } from 'react';
import { cssColorAsRgb, prefersReducedMotion } from '../../lib/motion.ts';
import { createPollen, type Grain, grainAlpha, type PollenBounds } from './pollen.ts';

interface PollenFieldProps {
  /** number of grains in the air; fewer on small screens */
  count: number;
  /** the emblem the grains lift off from */
  emitterRef: RefObject<HTMLElement | null>;
  /** the card kept free of newborn ambient grains */
  cardRef?: RefObject<HTMLElement | null>;
}

const LINK = 64;
const GRAB = 170;
const MAX_THREADS_PER_GRAIN = 2;
const PREROLL_FRAMES = 3000;
const PALE = '255,248,230';

/**
 * Full-bleed canvas behind and over the landing card: pollen drifting on the
 * wind (see pollen.ts). Decorative only: hidden from assistive tech, never
 * intercepts the pointer, and a single still frame under reduced motion.
 * @rfc RFC-10 R3
 */
export function PollenField({ count, emitterRef, cardRef }: PollenFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const accent = cssColorAsRgb(canvas, '--color-pollen-500', '232,163,61');
    let width = 0;
    let height = 0;

    const measure = (): PollenBounds => {
      const hostBox = host.getBoundingClientRect();
      const stage = emitterRef.current?.getBoundingClientRect();
      const card = cardRef?.current?.getBoundingClientRect();
      const emitter = stage
        ? {
            x: stage.left - hostBox.left + stage.width * 0.5,
            y: stage.top - hostBox.top + stage.height * 0.42,
            r: stage.width * 0.36,
          }
        : { x: width * 0.3, y: height * 0.45, r: 40 };
      return {
        width,
        height,
        emitter,
        card: card
          ? {
              left: card.left - hostBox.left,
              top: card.top - hostBox.top,
              right: card.right - hostBox.left,
              bottom: card.bottom - hostBox.top,
            }
          : null,
      };
    };

    const resize = () => {
      const box = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const pollen = createPollen(measure(), { count });
    for (let i = 0; i < PREROLL_FRAMES; i++) pollen.step(i * 16);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const grains = pollen.grains;
      const pointer = pollen.pointer;
      // each grain joins at most a couple of neighbours, so a cluster reads as threads, not a mesh
      const threads = new Uint8Array(grains.length);
      ctx.lineWidth = 1;
      for (let i = 0; i < grains.length; i++) {
        const a = grains[i] as Grain;
        const aa = grainAlpha(a.age, a.life);
        for (let j = i + 1; j < grains.length; j++) {
          if ((threads[i] as number) >= MAX_THREADS_PER_GRAIN) break;
          if ((threads[j] as number) >= MAX_THREADS_PER_GRAIN) continue;
          const b = grains[j] as Grain;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= LINK * LINK) continue;
          const alpha = (1 - Math.sqrt(d2) / LINK) * 0.12 * Math.min(aa, grainAlpha(b.age, b.life));
          if (alpha < 0.01) continue;
          threads[i] = (threads[i] as number) + 1;
          threads[j] = (threads[j] as number) + 1;
          ctx.strokeStyle = `rgba(255,240,210,${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        if (pointer) {
          const md = Math.hypot(a.x - pointer.x, a.y - pointer.y);
          if (md < GRAB) {
            ctx.strokeStyle = `rgba(${accent},${((1 - md / GRAB) * 0.6 * aa).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }
      for (const g of grains) {
        const alpha = grainAlpha(g.age, g.life);
        if (alpha <= 0) continue;
        ctx.fillStyle = g.warm
          ? `rgba(${accent},${(0.85 * alpha).toFixed(3)})`
          : `rgba(${PALE},${(0.7 * alpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
        ctx.fill();
        if (g.r > 2) {
          // the larger grains carry a soft halo
          ctx.fillStyle = `rgba(${accent},${(0.12 * alpha).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.r * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    if (prefersReducedMotion()) {
      draw();
      return;
    }

    const onMove = (event: MouseEvent | TouchEvent) => {
      const point = 'touches' in event ? event.touches[0] : event;
      if (!point) return;
      const box = canvas.getBoundingClientRect();
      pollen.setPointer(point.clientX - box.left, point.clientY - box.top);
    };
    const onLeave = () => pollen.clearPointer();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('touchend', onLeave);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            resize();
            pollen.setBounds(measure());
          });
    observer?.observe(host);

    let frame = 0;
    let handle = 0;
    const loop = (t: number) => {
      if (++frame % 30 === 0) pollen.setBounds(measure());
      pollen.step(t);
      draw();
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(handle);
      observer?.disconnect();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('touchend', onLeave);
    };
  }, [count, emitterRef, cardRef]);

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas without tabIndex is not focusable, and this one is purely decorative
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 block h-full w-full"
    />
  );
}
