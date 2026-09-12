/**
 * True when the visitor asked the OS for less motion. Read once per call so a
 * component can decide at mount time; jsdom has no matchMedia, hence the guard.
 * @rfc RFC-10 R3
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reads a `#rrggbb` CSS custom property from an element and returns `r,g,b`
 * for use inside `rgba(...)` strings; falls back when the token is missing.
 * @rfc RFC-10 R3
 */
export function cssColorAsRgb(element: Element, property: string, fallback: string): string {
  const raw = getComputedStyle(element).getPropertyValue(property).trim();
  const match = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!match) return fallback;
  const n = Number.parseInt(match[1] as string, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
