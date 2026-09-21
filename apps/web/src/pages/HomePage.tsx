import type { AuthUser } from '@treerepro/contracts';
import { useEffect, useRef, useState } from 'react';
import { LoginForm } from '../components/landing/LoginForm.tsx';
import { PollenField } from '../components/landing/PollenField.tsx';
import { type RevealPhase, runReveal, travelOffset } from '../components/landing/reveal.ts';
import { TreeEmblem } from '../components/landing/TreeEmblem.tsx';
import { prefersReducedMotion } from '../lib/motion.ts';
import '../components/landing/landing.css';

/**
 * How the page leaves once sign-in resolves: `reveal` after the landing beats
 * of the sign-in reveal, so the route should navigate with a view transition;
 * `none` at once, so it should navigate plainly (reduced motion).
 * @rfc RFC-13 R7
 */
export type SignedInTransition = 'reveal' | 'none';

interface HomePageProps {
  onSignedIn: (user: AuthUser, transition: SignedInTransition) => void;
}

/**
 * The landing page: the only public screen. Sign in on the right, the emblem
 * on the left, pollen in the air. The route redirects a signed-in visitor to
 * the workspace before this ever renders. Once sign-in resolves the page plays
 * the landing beats of the reveal — the form recedes, then the emblem travels
 * to the centre of the viewport and grows — before handing the user over.
 * @rfc RFC-13 R2, R7
 * @rfc RFC-22 R7
 */
export function HomePage({ onSignedIn }: HomePageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const travelRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const cancelReveal = useRef<() => void>(() => {});
  const [phase, setPhase] = useState<RevealPhase | 'idle'>('idle');
  const [grainCount] = useState(() => (window.innerWidth < 720 ? 24 : 50));

  useEffect(() => () => cancelReveal.current(), []);

  function signedIn(user: AuthUser) {
    if (phase !== 'idle') return; // the reveal is already on its way
    if (prefersReducedMotion()) {
      onSignedIn(user, 'none');
      return;
    }
    const stage = stageRef.current;
    const travel = travelRef.current;
    if (stage && travel) {
      // the offset is written through the CSSOM, as the tilt is (RFC-13 R5)
      const { dx, dy } = travelOffset(stage.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      travel.style.setProperty('--tr-dx', `${Math.round(dx)}px`);
      travel.style.setProperty('--tr-dy', `${Math.round(dy)}px`);
    }
    cancelReveal.current();
    cancelReveal.current = runReveal({
      onPhase: setPhase,
      onLeave: () => onSignedIn(user, 'reveal'),
    });
  }

  // Ahead of the utilities: Tailwind reads class names out of the source, and
  // a `${…}` glued to `md:flex-row` would hide that utility from it.
  const cardPhase = phase === 'idle' ? '' : phase === 'recede' ? 'tr-recede' : 'tr-recede tr-gone';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(135deg,var(--color-canopy-950)_0%,var(--color-canopy-700)_52%,var(--color-pollen-600)_100%)] px-4 py-6 text-mist-50">
      <PollenField count={grainCount} emitterRef={stageRef} cardRef={cardRef} />

      <section
        ref={cardRef}
        aria-label="Sign in to TreeRepro"
        className={`${cardPhase} tr-rise relative z-10 flex w-[1100px] max-w-full flex-col md:min-h-[640px] md:flex-row`}
      >
        {/* The card's surface is its own layer so the reveal can fade it while the emblem, a child of the card, travels on. */}
        <div
          aria-hidden="true"
          className="tr-card-surface absolute inset-0 rounded-[22px] border border-white/10 border-t-white/16 bg-canopy-900/90 shadow-[0_30px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-[10px]"
        />
        <div className="relative flex flex-col items-center justify-center gap-6 px-6 pt-11 pb-2 md:basis-[46%] md:gap-9 md:px-12 md:py-16">
          <div ref={travelRef} className={phase === 'grow' ? 'tr-travel tr-grow' : 'tr-travel'}>
            <TreeEmblem ref={stageRef} />
          </div>
          <p className="tr-caption max-w-[300px] text-center text-sm leading-relaxed text-mist-300">
            Flowering, fruiting and seed data, recorded in the field.
          </p>
        </div>

        {/* inert once the form has receded: invisible, so out of reach for the keyboard and assistive tech too */}
        <div
          inert={phase !== 'idle'}
          className="tr-form-side relative flex flex-1 flex-col justify-center gap-9 px-6 pt-6 pb-9 md:py-16 md:pr-18 md:pl-10"
        >
          <header className="tr-rise tr-rise-1 flex flex-col gap-1.5">
            <h1 className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-mist-400">
              TreeRepro
            </h1>
            <h2 className="font-display text-[28px] font-bold tracking-tight text-white md:text-[34px]">
              Welcome back
            </h2>
            <p className="font-display text-base font-semibold text-pollen-500">
              Tracking how trees reproduce.
            </p>
          </header>

          <div className="tr-rise tr-rise-2">
            <LoginForm onSignedIn={signedIn} />
          </div>

          <footer className="tr-rise tr-rise-3 flex justify-center border-t border-white/12 pt-5 text-xs text-mist-400">
            <span>© {new Date().getFullYear()} TreeRepro</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
