import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { fetchMe, logout } from '../api/auth.ts';
import { LoginForm } from '../components/landing/LoginForm.tsx';
import { PollenField } from '../components/landing/PollenField.tsx';
import { TreeEmblem } from '../components/landing/TreeEmblem.tsx';
import '../components/landing/landing.css';

const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * The landing page: the only public screen. Sign in on the right, the emblem
 * on the left, pollen in the air. A visitor with a live session sees who they
 * are signed in as until the workspace pages exist.
 * @rfc RFC-13 R2
 * @rfc RFC-22 R7
 */
export function HomePage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [grainCount] = useState(() => (window.innerWidth < 720 ? 24 : 50));
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => queryClient.resetQueries({ queryKey: ME_QUERY_KEY }),
  });
  // A failed refetch (session expired) keeps stale data around; only trust a successful answer.
  const session = me.status === 'success' ? me.data : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(135deg,var(--color-canopy-950)_0%,var(--color-canopy-700)_52%,var(--color-pollen-600)_100%)] px-4 py-6 text-mist-50">
      <PollenField count={grainCount} emitterRef={stageRef} cardRef={cardRef} />

      <section
        ref={cardRef}
        aria-label="Sign in to TreeRepro"
        className="tr-rise relative z-10 flex w-[1100px] max-w-full flex-col overflow-hidden rounded-[22px] border border-white/10 border-t-white/16 bg-canopy-900/90 shadow-[0_30px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-[10px] md:min-h-[640px] md:flex-row"
      >
        <div className="flex flex-col items-center justify-center gap-6 px-6 pt-11 pb-2 md:basis-[46%] md:gap-9 md:px-12 md:py-16">
          <TreeEmblem ref={stageRef} />
          <p className="max-w-[300px] text-center text-sm leading-relaxed text-mist-300">
            Flowering, fruiting and seed data, recorded in the field.
          </p>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-9 px-6 pt-6 pb-9 md:py-16 md:pr-18 md:pl-10">
          <header className="tr-rise tr-rise-1 flex flex-col gap-1.5">
            <h1 className="font-display text-xs font-semibold uppercase tracking-[0.28em] text-mist-400">
              TreeRepro
            </h1>
            <h2 className="font-display text-[28px] font-bold tracking-tight text-white md:text-[34px]">
              {session ? `Signed in as ${session.user.name}` : 'Welcome back'}
            </h2>
            <p className="font-display text-base font-semibold text-pollen-500">
              Tracking how trees reproduce.
            </p>
          </header>

          <div className="tr-rise tr-rise-2">
            {me.isPending ? null : session ? (
              <div className="flex flex-col items-start gap-6">
                <p className="text-sm leading-relaxed text-mist-300">
                  Your workspace opens here in the next release. You can sign out on this device for
                  now.
                </p>
                <button
                  type="button"
                  onClick={() => signOut.mutate()}
                  disabled={signOut.isPending}
                  className="tr-cta relative isolate inline-flex h-[46px] min-w-[220px] items-center justify-center rounded-full px-7 font-display text-sm font-bold uppercase tracking-[0.08em] text-ink disabled:cursor-progress"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <LoginForm
                onSignedIn={() => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })}
              />
            )}
          </div>

          <footer className="tr-rise tr-rise-3 flex justify-center border-t border-white/12 pt-5 text-xs text-mist-400">
            <span>© {new Date().getFullYear()} TreeRepro</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
