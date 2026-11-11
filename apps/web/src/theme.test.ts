import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest stubs CSS imports, `?raw` included, so the file is read from disk.
const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');

/** `--color-canopy-<n>: #hex` pairs of a CSS block. */
function canopy(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--color-canopy-(\d+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const theme = canopy(css.slice(css.indexOf('@theme'), css.indexOf('}', css.indexOf('@theme'))));
const plantStart = css.indexOf('[data-platform="plantrepro"]');
const plum = canopy(css.slice(plantStart, css.indexOf('}', plantStart)));
const MIST_50 = /--color-mist-50:\s*(#[0-9a-f]{6})/i.exec(css)?.[1] as string;

describe('RFC-13 R14 PlantRepro plum tokens', () => {
  it('override every canopy token', () => {
    expect(Object.keys(plum).sort()).toEqual(Object.keys(theme).sort());
  });

  // Every pair of a canopy shade with a surface (white, mist-50, canopy-900)
  // that meets WCAG AA text (4.5:1) or large-text (3:1) contrast on TreeRepro
  // meets it with the plum set too.
  it.each(Object.keys(theme))('canopy-%s keeps the contrast level it reaches', (shade) => {
    const surfaces = (set: Record<string, string>) => ['#ffffff', MIST_50, set['900'] as string];
    surfaces(theme).forEach((surface, i) => {
      const before = contrast(theme[shade] as string, surface);
      const after = contrast(plum[shade] as string, surfaces(plum)[i] as string);
      for (const level of [4.5, 3])
        if (before >= level) expect(after, `${shade} on ${surface}`).toBeGreaterThanOrEqual(level);
    });
  });
});
