import { useId } from 'react';

export interface EmblemProps {
  /** Rendered width and height; a percentage fills the parent (the landing stage). */
  size: number | string;
  className?: string;
}

/**
 * The TreeRepro emblem — a tree in fruit inside a disc — as a still image.
 * The landing page wraps it in motion (`TreeEmblem`); the workspace shows
 * it as is in the sidebar. Gradient ids come from `useId` so several
 * emblems on one page do not share (and hijack) each other's paint. The
 * `tr-canopy` group and the `tr-fruit` circles are hooks for the sign-in
 * reveal's bloom and pop (landing.css); they style nothing on their own.
 * @rfc RFC-13 R5, R7
 */
export function Emblem({ size, className }: EmblemProps) {
  const id = useId();
  const url = (name: string) => `url(#${id}${name})`;
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="img"
      aria-label="TreeRepro emblem: a tree in fruit"
      className={className}
    >
      <title>TreeRepro emblem: a tree in fruit</title>
      <defs>
        <radialGradient id={`${id}disc`} cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor="var(--color-canopy-600)" />
          <stop offset="60%" stopColor="var(--color-canopy-800)" />
          <stop offset="100%" stopColor="#072b26" />
        </radialGradient>
        <radialGradient id={`${id}c1`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--color-canopy-500)" />
          <stop offset="100%" stopColor="#1b6b57" />
        </radialGradient>
        <radialGradient id={`${id}c2`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#7ccf9f" />
          <stop offset="100%" stopColor="#2f9d7c" />
        </radialGradient>
        <radialGradient id={`${id}c3`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--color-canopy-200)" />
          <stop offset="100%" stopColor="var(--color-canopy-400)" />
        </radialGradient>
        <linearGradient id={`${id}trunk`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-bark-700)" />
          <stop offset="55%" stopColor="var(--color-bark-500)" />
          <stop offset="100%" stopColor="var(--color-bark-700)" />
        </linearGradient>
        <radialGradient id={`${id}fruit`} cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor="var(--color-pollen-300)" />
          <stop offset="100%" stopColor="var(--color-pollen-500)" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill={url('disc')} />
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
      <g className="tr-canopy">
        <path
          d="M100 152 C96 140 95 128 96 112 C90 106 78 100 72 92 M96 112 C104 104 112 100 122 96 M100 152 C106 156 112 157 118 156 M100 152 C93 156 87 157 80 155"
          fill="none"
          stroke={url('trunk')}
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="76" cy="86" r="34" fill={url('c1')} />
        <circle cx="126" cy="90" r="32" fill={url('c2')} />
        <circle cx="100" cy="64" r="32" fill={url('c3')} />
        <circle cx="92" cy="98" r="18" fill={url('c2')} opacity="0.9" />
        <circle className="tr-fruit" cx="70" cy="98" r="4.5" fill={url('fruit')} />
        <circle className="tr-fruit" cx="118" cy="74" r="4.5" fill={url('fruit')} />
        <circle className="tr-fruit" cx="136" cy="102" r="4" fill={url('fruit')} />
        <circle className="tr-fruit" cx="88" cy="70" r="3.5" fill={url('fruit')} />
        <circle className="tr-fruit" cx="106" cy="108" r="3.5" fill={url('fruit')} />
      </g>
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
  );
}
