import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { meQueryOptions } from '../lib/session.ts';
import { HomePage } from '../pages/HomePage.tsx';

/**
 * A signed-in visitor belongs in the workspace. After a sign-in the page
 * plays the landing beats of the reveal and then asks for the navigation as
 * a view transition, which carries the emblem into the sidebar (landing.css);
 * under reduced motion it asks for a plain one at once. Should `/app`'s guard
 * send the visitor straight back here, the page is mounted afresh: the route
 * match is unchanged, so nothing else would reset a landing left mid-reveal.
 * @rfc RFC-13 R2, R7
 */
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    // staleTime: 0 forces a real API check; after sign-out the cached `me`
    // entry is only removed once navigation resolves, so the 60s default
    // staleTime would still read as fresh and bounce `/` straight back here.
    const me = await context.queryClient
      .fetchQuery({ ...meQueryOptions, staleTime: 0 })
      .catch(() => null);
    if (me) throw redirect({ to: '/app' });
  },
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  return (
    <HomePage
      key={attempt}
      onSignedIn={async (_user, transition) => {
        await navigate({ to: '/app', viewTransition: transition === 'reveal' });
        if (router.state.location.pathname === '/') setAttempt((n) => n + 1);
      }}
    />
  );
}
