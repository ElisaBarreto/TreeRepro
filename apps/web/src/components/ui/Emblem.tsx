import type { Platform } from '@treerepro/contracts';
import { type ReactNode, useId } from 'react';
import { currentPlatform } from '../../lib/platform.ts';

export interface EmblemProps {
  /** Rendered width and height; a percentage fills the parent (the landing stage). */
  size: number | string;
  className?: string;
  /** Which platform's emblem; the current platform's when omitted (RFC-13 R14). */
  variant?: Platform;
}

/** The colours of one variant: the TreeRepro tree reads the theme, the forest is fixed. */
interface Paint {
  disc: [string, string, string];
  c1: [string, string];
  c3: [string, string];
  trunk: [string, string];
  fruit: [string, string];
}

const TREE_PAINT: Paint = {
  disc: ['var(--color-canopy-600)', 'var(--color-canopy-800)', '#072b26'],
  c1: ['var(--color-canopy-500)', '#1b6b57'],
  c3: ['var(--color-canopy-200)', 'var(--color-canopy-400)'],
  trunk: ['var(--color-bark-700)', 'var(--color-bark-500)'],
  fruit: ['var(--color-pollen-300)', 'var(--color-pollen-500)'],
};

// PlantRepro's canopy tokens are plum, so the forest's greens are written out
// (TreeRepro's canopy hexes) and its disc is the plum set's.
const FOREST_PAINT: Paint = {
  disc: ['#c060a3', '#74225c', '#2a0b21'],
  c1: ['#3faa86', '#1b6b57'],
  c3: ['#b5ebc9', '#5fbf8a'],
  trunk: ['#8a5426', '#c1863f'],
  fruit: ['#ffd777', '#e8a33d'],
};

const NAMES: Record<Platform, string> = {
  treerepro: 'TreeRepro emblem: a tree in fruit',
  plantrepro: 'PlantRepro emblem: a tree in fruit among a conifer, a flower, a fern and grass',
};

/**
 * The platform's emblem as a still image: TreeRepro's tree in fruit inside a
 * disc, or PlantRepro's forest — the same tree, smaller, among a conifer, a
 * pink flower, a fern and grass on a plum disc (RFC-13 R14).
 * The landing page wraps it in motion (`TreeEmblem`); the workspace shows
 * it as is in the sidebar. Gradient ids come from `useId` so several
 * emblems on one page do not share (and hijack) each other's paint. The
 * `tr-canopy` group and the `tr-fruit` circles are hooks for the sign-in
 * reveal's bloom and pop (landing.css); they style nothing on their own.
 * @rfc RFC-13 R5, R7, R14
 */
export function Emblem({ size, className, variant = currentPlatform() }: EmblemProps) {
  const id = useId();
  const url = (name: string) => `url(#${id}${name})`;
  const paint = variant === 'plantrepro' ? FOREST_PAINT : TREE_PAINT;
  const name = NAMES[variant];
  // The canopy group and its fruits are the sign-in reveal's hooks (landing.css).
  const tree: ReactNode = (
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
  );
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="img"
      aria-label={name}
      className={className}
    >
      <title>{name}</title>
      <defs>
        <radialGradient id={`${id}disc`} cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor={paint.disc[0]} />
          <stop offset="60%" stopColor={paint.disc[1]} />
          <stop offset="100%" stopColor={paint.disc[2]} />
        </radialGradient>
        <radialGradient id={`${id}c1`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={paint.c1[0]} />
          <stop offset="100%" stopColor={paint.c1[1]} />
        </radialGradient>
        <radialGradient id={`${id}c2`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#7ccf9f" />
          <stop offset="100%" stopColor="#2f9d7c" />
        </radialGradient>
        <radialGradient id={`${id}c3`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={paint.c3[0]} />
          <stop offset="100%" stopColor={paint.c3[1]} />
        </radialGradient>
        <linearGradient id={`${id}trunk`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={paint.trunk[0]} />
          <stop offset="55%" stopColor={paint.trunk[1]} />
          <stop offset="100%" stopColor={paint.trunk[0]} />
        </linearGradient>
        <radialGradient id={`${id}fruit`} cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor={paint.fruit[0]} />
          <stop offset="100%" stopColor={paint.fruit[1]} />
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
      {variant === 'plantrepro' ? (
        <>
          <Forest />
          {/* The tree, smaller, rooted where it stands on TreeRepro's disc. */}
          <g transform="translate(100 152) scale(0.72) translate(-100 -152)">{tree}</g>
          <Flower />
        </>
      ) : (
        <>
          {tree}
          {/* Two seeds drifting off the tree. */}
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
        </>
      )}
    </svg>
  );
}

/** The forest behind the tree: a conifer, a fern and grass (RFC-13 R14). */
function Forest() {
  return (
    <g>
      <rect x="47" y="132" width="7" height="20" rx="2" fill="#8a5426" />
      <path d="M50 56 L33 92 H67 Z" fill="#2f9d7c" />
      <path d="M50 74 L28 114 H72 Z" fill="#1f8f7a" />
      <path d="M50 94 L24 136 H76 Z" fill="#1b6b57" />
      <g fill="none" stroke="#5fbf8a" strokeWidth="2.5" strokeLinecap="round">
        <path d="M78 156 Q60 146 44 128" />
        <path d="M70 150 l-2 -8 M62 145 l-3 -7 M55 139 l-4 -6 M49 133 l-4 -5" />
        <path d="M70 150 l-7 2 M62 145 l-7 1 M55 139 l-6 1 M49 133 l-5 0" />
      </g>
      <g fill="none" stroke="#7fd1a5" strokeWidth="2.5" strokeLinecap="round">
        <path d="M86 156 l-4 -13 M90 156 l0 -16 M94 156 l4 -12" />
        <path d="M120 156 l-4 -12 M124 156 l0 -15 M128 156 l4 -11" />
      </g>
    </g>
  );
}

/** A pink flower on its stem, right of the tree (RFC-13 R14). */
function Flower() {
  return (
    <g>
      <path
        d="M150 156 C148 140 152 126 148 110"
        fill="none"
        stroke="#3faa86"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M149 136 c8 -8 16 -6 18 -4 c-6 6 -12 8 -18 4 z" fill="#5fbf8a" />
      <g fill="#f08fc4">
        <ellipse cx="148" cy="94" rx="6" ry="10" />
        <ellipse cx="148" cy="94" rx="6" ry="10" transform="rotate(72 148 104)" />
        <ellipse cx="148" cy="94" rx="6" ry="10" transform="rotate(144 148 104)" />
        <ellipse cx="148" cy="94" rx="6" ry="10" transform="rotate(216 148 104)" />
        <ellipse cx="148" cy="94" rx="6" ry="10" transform="rotate(288 148 104)" />
      </g>
      <circle cx="148" cy="104" r="5" fill="#f2c14e" />
    </g>
  );
}
