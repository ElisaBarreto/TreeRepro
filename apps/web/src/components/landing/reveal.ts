/**
 * The beats of the sign-in reveal, in ms from the moment sign-in resolves:
 * the form recedes at once, the emblem sets off for the centre of the
 * viewport at `grow` (1.2 s), holds there while its canopy swells and its
 * fruits pop (landing.css: every one of those ends by `leave`, because the
 * navigation snapshots the page and a frozen half-pop would travel into the
 * sidebar), and at `leave` the page hands over to the `/app` navigation — a
 * view transition in which the tree keeps its full size a little longer
 * under the opening workspace before it shrinks into the sidebar. Pure:
 * HomePage owns the DOM side.
 * @rfc RFC-13 R7
 */
export const REVEAL = { recede: 0, grow: 350, leave: 2750 } as const;

export type RevealPhase = 'recede' | 'grow';

export interface RevealCallbacks {
  onPhase: (phase: RevealPhase) => void;
  onLeave: () => void;
}

/**
 * Runs the landing-side beats of the reveal and returns a function that
 * cancels whatever is still to come (unmount, a second sign-in).
 * @rfc RFC-13 R7
 */
export function runReveal({ onPhase, onLeave }: RevealCallbacks): () => void {
  onPhase('recede');
  const timers = [
    setTimeout(() => onPhase('grow'), REVEAL.grow),
    setTimeout(onLeave, REVEAL.leave),
  ];
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}

/**
 * The vector that carries the stage from where it sits to the centre of the
 * viewport; HomePage writes it to `--tr-dx` / `--tr-dy` for `.tr-grow`.
 * @rfc RFC-13 R7
 */
export function travelOffset(
  stage: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
): { dx: number; dy: number } {
  return {
    dx: viewport.width / 2 - (stage.left + stage.width / 2),
    dy: viewport.height / 2 - (stage.top + stage.height / 2),
  };
}
