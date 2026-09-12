import { describe, expect, it } from 'vitest';
import { createPollen, grainAlpha, type PollenBounds } from './pollen.ts';

const bounds: PollenBounds = {
  width: 1000,
  height: 600,
  emitter: { x: 300, y: 300, r: 40 },
  card: { left: 200, top: 150, right: 800, bottom: 450 },
};

// Deterministic sequence so the tests do not flake.
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe('RFC-13 R7 pollen simulation', () => {
  it('spawns the requested number of grains, half from the canopy and half in the open air', () => {
    const pollen = createPollen(bounds, { count: 100, random: seeded() });
    expect(pollen.grains).toHaveLength(100);
    const fromTree = pollen.grains.filter((g) => !g.ambient);
    const ambient = pollen.grains.filter((g) => g.ambient);
    expect(fromTree).toHaveLength(50);
    expect(ambient).toHaveLength(50);
    for (const g of fromTree) {
      expect(Math.hypot(g.x - 300, g.y - 300)).toBeLessThanOrEqual(41);
      expect(g.age).toBe(0);
    }
    for (const g of ambient) {
      const insideCard = g.x > 200 && g.x < 800 && g.y > 150 && g.y < 450;
      expect(insideCard).toBe(false);
    }
  });

  it('drifts grains slowly up and to the left', () => {
    const pollen = createPollen(bounds, { count: 50, random: seeded(7) });
    const before = pollen.grains.map((g) => ({ x: g.x, y: g.y }));
    for (let t = 0; t < 120; t++) pollen.step(t * 16);
    let dx = 0;
    let dy = 0;
    pollen.grains.forEach((g, i) => {
      const b = before[i] as { x: number; y: number };
      dx += g.x - b.x;
      dy += g.y - b.y;
    });
    expect(dx / 50).toBeLessThan(0);
    expect(dy / 50).toBeLessThan(0);
    for (const g of pollen.grains) {
      expect(Math.abs(g.vx)).toBeLessThanOrEqual(0.18);
      expect(Math.abs(g.vy)).toBeLessThanOrEqual(0.14);
    }
  });

  it('is reborn at the canopy after leaving the page or growing old', () => {
    const pollen = createPollen(bounds, { count: 1, random: seeded(3) });
    const grain = pollen.grains[0] as NonNullable<(typeof pollen.grains)[0]>;
    grain.x = -30;
    grain.age = 10;
    pollen.step(0);
    expect(grain.x).toBeGreaterThan(200);
    expect(grain.age).toBe(0);

    grain.age = grain.life + 1;
    pollen.step(16);
    expect(grain.age).toBe(0);
  });

  it('scatters grains away from the pointer', () => {
    const pollen = createPollen(bounds, { count: 1, random: seeded(5) });
    const grain = pollen.grains[0] as NonNullable<(typeof pollen.grains)[0]>;
    grain.x = 500;
    grain.y = 300;
    grain.vx = 0;
    grain.vy = 0;
    pollen.setPointer(480, 300); // just left of the grain
    pollen.step(0);
    expect(grain.vx).toBeGreaterThan(0);
    pollen.clearPointer();
    expect(pollen.pointer).toBeNull();
  });

  it('fades grains in at birth and out toward the end of their life', () => {
    expect(grainAlpha(0, 1000)).toBe(0);
    expect(grainAlpha(80, 1000)).toBeCloseTo(1);
    expect(grainAlpha(500, 1000)).toBe(1);
    expect(grainAlpha(1000, 1000)).toBe(0);
  });
});
