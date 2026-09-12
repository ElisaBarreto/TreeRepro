/**
 * Pollen for the landing page: grains lift off the canopy, ride a slow wind up
 * and to the left, fade, and are reborn at the tree. Part of the grains already
 * hang in the open air so the whole page breathes, not only the emblem.
 * Pure simulation, no DOM: PollenField.tsx draws it.
 */

export interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** radius in px */
  r: number;
  /** frames lived and frames to live */
  age: number;
  life: number;
  /** phase offset so grains do not swirl in lockstep */
  seed: number;
  /** golden (true) or pale (false) */
  warm: boolean;
  /** born in the open air instead of at the canopy */
  ambient: boolean;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PollenBounds {
  width: number;
  height: number;
  /** where grains are born: canopy centre and radius, in canvas px */
  emitter: { x: number; y: number; r: number };
  /** the card, kept free of newborn ambient grains; null when unknown */
  card: Box | null;
}

export interface PollenOptions {
  count: number;
  random?: () => number;
}

export interface Pollen {
  readonly grains: Grain[];
  readonly pointer: { x: number; y: number } | null;
  setBounds(bounds: PollenBounds): void;
  setPointer(x: number, y: number): void;
  clearPointer(): void;
  /** advance one frame; `t` is a clock in ms used only for the wind phase */
  step(t: number): void;
}

const AMBIENT_SHARE = 0.5;
const GUST_RADIUS = 120;
const GUST_FORCE = 0.12;
const MAX_VX = 0.18;
const MAX_VY = 0.14;

/** Fade in over the first 8% of a life, hold, fade out over the last 25%. @rfc RFC-13 R7 */
export function grainAlpha(age: number, life: number): number {
  const k = age / life;
  const env = k < 0.08 ? k / 0.08 : k > 0.75 ? (1 - k) / 0.25 : 1;
  return Math.max(0, Math.min(1, env));
}

/** @rfc RFC-13 R7 */
export function createPollen(initial: PollenBounds, options: PollenOptions): Pollen {
  const random = options.random ?? Math.random;
  let bounds = initial;
  let pointer: { x: number; y: number } | null = null;

  const insideCard = (x: number, y: number) => {
    const c = bounds.card;
    return c !== null && x > c.left && x < c.right && y > c.top && y < c.bottom;
  };

  const spawn = (g: Grain, ambient: boolean): Grain => {
    if (ambient) {
      let tries = 0;
      do {
        g.x = random() * bounds.width;
        g.y = random() * bounds.height;
      } while (insideCard(g.x, g.y) && ++tries < 12);
      g.age = random() * 1500;
    } else {
      const a = random() * Math.PI * 2;
      const d = Math.sqrt(random()) * bounds.emitter.r;
      g.x = bounds.emitter.x + Math.cos(a) * d;
      g.y = bounds.emitter.y + Math.sin(a) * d * 0.8;
      g.age = 0;
    }
    g.vx = -0.01 - random() * 0.06;
    g.vy = -0.03 - random() * 0.05;
    g.r = 0.9 + random() * 1.7;
    g.life = 2400 + random() * 1600;
    g.seed = random() * 1000;
    g.warm = random() < 0.6;
    g.ambient = ambient;
    return g;
  };

  const blank = (): Grain => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 1,
    age: 0,
    life: 1,
    seed: 0,
    warm: true,
    ambient: false,
  });

  const ambientCount = Math.floor(options.count * AMBIENT_SHARE);
  const grains: Grain[] = [];
  for (let i = 0; i < options.count; i++) {
    grains.push(spawn(blank(), i >= options.count - ambientCount));
  }

  const step = (t: number) => {
    const { width, height } = bounds;
    for (const g of grains) {
      // slow, swirling wind with a steady pull up and to the left
      const swirl = Math.sin(t * 0.0004 + g.y * 0.012 + g.seed) * 0.006;
      const lift = Math.cos(t * 0.0005 + g.x * 0.01 + g.seed) * 0.006;
      g.vx = clamp(g.vx * 0.995 + swirl - 0.0002, -MAX_VX, 0.1);
      g.vy = clamp(g.vy * 0.995 + lift - 0.0001, -MAX_VY, 0.08);

      if (pointer) {
        const dx = g.x - pointer.x;
        const dy = g.y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < GUST_RADIUS && d > 0.01) {
          const f = ((GUST_RADIUS - d) / GUST_RADIUS) * GUST_FORCE;
          g.vx += (dx / d) * f;
          g.vy += (dy / d) * f;
        }
      }

      g.x += g.vx;
      g.y += g.vy;
      g.age++;
      const gone = g.x > width + 20 || g.x < -20 || g.y < -20 || g.y > height + 20;
      if (gone || g.age > g.life) spawn(g, g.ambient);
    }
  };

  return {
    grains,
    get pointer() {
      return pointer;
    },
    setBounds(next) {
      bounds = next;
    },
    setPointer(x, y) {
      pointer = { x, y };
    },
    clearPointer() {
      pointer = null;
    },
    step,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
