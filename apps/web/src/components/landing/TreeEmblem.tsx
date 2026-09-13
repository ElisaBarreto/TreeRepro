import { type CSSProperties, type Ref, useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/motion.ts';
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
        <svg
          viewBox="0 0 200 200"
          width="100%"
          height="100%"
          role="img"
          aria-label="TreeRepro emblem: a tree in fruit"
        >
          <title>TreeRepro emblem: a tree in fruit</title>
          <defs>
            <radialGradient id="tr-disc" cx="38%" cy="30%" r="80%">
              <stop offset="0%" stopColor="var(--color-canopy-600)" />
              <stop offset="60%" stopColor="var(--color-canopy-800)" />
              <stop offset="100%" stopColor="#072b26" />
            </radialGradient>
            <radialGradient id="tr-c1" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="var(--color-canopy-500)" />
              <stop offset="100%" stopColor="#1b6b57" />
            </radialGradient>
            <radialGradient id="tr-c2" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#7ccf9f" />
              <stop offset="100%" stopColor="#2f9d7c" />
            </radialGradient>
            <radialGradient id="tr-c3" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="var(--color-canopy-200)" />
              <stop offset="100%" stopColor="var(--color-canopy-400)" />
            </radialGradient>
            <linearGradient id="tr-trunk" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-bark-700)" />
              <stop offset="55%" stopColor="var(--color-bark-500)" />
              <stop offset="100%" stopColor="var(--color-bark-700)" />
            </linearGradient>
            <radialGradient id="tr-fruit" cx="35%" cy="35%" r="70%">
              <stop offset="0%" stopColor="var(--color-pollen-300)" />
              <stop offset="100%" stopColor="var(--color-pollen-500)" />
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="96" fill="url(#tr-disc)" />
          <circle
            cx="100"
            cy="100"
            r="96"
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1.5"
          />
          <path
            d="M40 150 Q100 136 160 150"
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M100 152 C96 140 95 128 96 112 C90 106 78 100 72 92 M96 112 C104 104 112 100 122 96 M100 152 C106 156 112 157 118 156 M100 152 C93 156 87 157 80 155"
            fill="none"
            stroke="url(#tr-trunk)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="76" cy="86" r="34" fill="url(#tr-c1)" />
          <circle cx="126" cy="90" r="32" fill="url(#tr-c2)" />
          <circle cx="100" cy="64" r="32" fill="url(#tr-c3)" />
          <circle cx="92" cy="98" r="18" fill="url(#tr-c2)" opacity="0.9" />
          <circle cx="70" cy="98" r="4.5" fill="url(#tr-fruit)" />
          <circle cx="118" cy="74" r="4.5" fill="url(#tr-fruit)" />
          <circle cx="136" cy="102" r="4" fill="url(#tr-fruit)" />
          <circle cx="88" cy="70" r="3.5" fill="url(#tr-fruit)" />
          <circle cx="106" cy="108" r="3.5" fill="url(#tr-fruit)" />
          <path
            d="M144 118 c4 2 6 6 4 10 c-4 -1 -6 -5 -4 -10 z"
            fill="var(--color-pollen-400)"
            opacity="0.85"
          />
          <path
            d="M152 134 c3 2 4 5 3 8 c-3 -1 -5 -4 -3 -8 z"
            fill="var(--color-pollen-400)"
            opacity="0.55"
          />
        </svg>
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
