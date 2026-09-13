import { type CSSProperties, type Ref, useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/motion.ts';
import { Emblem } from '../ui/Emblem.tsx';
import './landing.css';

interface TreeEmblemProps {
  /** the stage element, so PollenField can find the canopy */
  ref?: Ref<HTMLDivElement>;
}

const TILT_DEGREES = 16;

const SEEDS = [
  { left: '30%', top: '38%', sway: '26px', turn: '220deg', dur: '8s', delay: '0s' },
  { left: '62%', top: '34%', sway: '-30px', turn: '-260deg', dur: '9.5s', delay: '2.2s' },
  { left: '48%', top: '30%', sway: '18px', turn: '300deg', dur: '11s', delay: '4.4s' },
  { left: '72%', top: '44%', sway: '-14px', turn: '-180deg', dur: '7.5s', delay: '1.1s' },
  { left: '22%', top: '46%', sway: '34px', turn: '200deg', dur: '10s', delay: '6s' },
];

/**
 * The landing emblem: a tree in fruit inside a disc, wrapped in a pulsing glow
 * and three rings, floating, letting seeds go, and leaning toward the pointer.
 * @rfc RFC-13 R7
 */
export function TreeEmblem({ ref }: TreeEmblemProps) {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || prefersReducedMotion()) return;

    const onMove = (event: MouseEvent) => {
      const box = stage.getBoundingClientRect();
      if (box.width === 0) return;
      // full tilt one stage-width away from the centre, in either direction
      const nx = clamp((event.clientX - (box.left + box.width / 2)) / (box.width * 2));
      const ny = clamp((event.clientY - (box.top + box.height / 2)) / (box.height * 2));
      stage.style.transform = `perspective(900px) rotateY(${(nx * TILT_DEGREES).toFixed(2)}deg) rotateX(${(-ny * TILT_DEGREES).toFixed(2)}deg)`;
      stage.style.setProperty('--mx', `${(50 + nx * 60).toFixed(1)}%`);
      stage.style.setProperty('--my', `${(50 + ny * 60).toFixed(1)}%`);
    };
    const onLeave = () => {
      stage.style.transform = 'perspective(900px) rotateY(0deg) rotateX(0deg)';
      stage.style.setProperty('--mx', '50%');
      stage.style.setProperty('--my', '50%');
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={(node) => {
        stageRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      className="tr-stage relative flex size-44 items-center justify-center md:size-64"
    >
      <div
        aria-hidden="true"
        className="tr-glow pointer-events-none absolute -inset-12 rounded-full blur-[28px]"
      />
      <div aria-hidden="true" className="tr-ring tr-ring-1" />
      <div aria-hidden="true" className="tr-ring tr-ring-2" />
      <div aria-hidden="true" className="tr-ring tr-ring-3" />

      <div className="tr-float relative size-36 drop-shadow-[0_18px_24px_rgba(0,0,0,0.45)] md:size-52">
        <Emblem size="100%" />
      </div>

      {SEEDS.map((seed) => (
        <span
          key={`${seed.left}-${seed.top}`}
          aria-hidden="true"
          className="tr-seed"
          style={
            {
              left: seed.left,
              top: seed.top,
              '--sway': seed.sway,
              '--turn': seed.turn,
              '--dur': seed.dur,
              '--delay': seed.delay,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function clamp(value: number): number {
  return Math.max(-0.5, Math.min(0.5, value));
}
